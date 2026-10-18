use std::cmp::Reverse;
use std::collections::BTreeMap;

use crate::actors::{ActorId, ActorKind};
use crate::breakdown::{Dimension, RowKey};
use crate::fight::{Event, EventKind, Fight, SpellId};
use crate::filter::ReportFilter;
use crate::interrupts::interrupts_report;
use crate::player::received_healing;
use crate::reports::damage::damage_done;
use crate::reports::healing::healing;
use crate::reports::taken::damage_taken;
use crate::reports::{AbilityRow, RowKind, per_second};
use crate::scope::{Scope, UnitRef};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeterCategory {
    DamageDone,
    HealingDone,
    DamageTaken,
    HealingReceived,
    Interrupts,
    Dispels,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeterKey {
    Ability {
        spell: SpellId,
        actor: ActorId,
        kind: RowKind,
    },
    /// A spell that hit the player, or the spell an interrupt or dispel stopped. World damage
    /// and melee are both spell 0; `environmental` keeps them apart.
    Spell { spell: SpellId, environmental: bool },
    /// A healer; pets count as their owner.
    Unit(ActorId),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MeterRow {
    pub player: ActorId,
    pub amount: i64,
    pub per_second: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MeterEntry {
    pub key: MeterKey,
    pub amount: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Meter {
    pub duration_ms: u64,
    /// Players with an amount, largest first.
    pub rows: Vec<MeterRow>,
    /// The expanded player's amount split, largest first.
    pub breakdown: Vec<MeterEntry>,
}

/// The players' amounts in the range, each equal to its report's, and `expand`'s split.
pub fn meter(
    fight: &Fight,
    filter: &ReportFilter,
    category: MeterCategory,
    expand: Option<ActorId>,
) -> Meter {
    let (amounts, breakdown) = match category {
        MeterCategory::DamageDone => {
            let report = damage_done(fight, filter);
            let breakdown = expanded(
                expand,
                &report.players,
                |p| p.player,
                |p| ability_entries(&p.abilities),
            );
            let amounts = report.players.iter().map(|p| (p.player, p.total as i64));
            (amounts.collect(), breakdown)
        }
        MeterCategory::HealingDone => {
            let report = healing(fight, filter);
            let breakdown = expanded(
                expand,
                &report.players,
                |p| p.player,
                |p| ability_entries(&p.abilities),
            );
            let amounts = report.players.iter().map(|p| (p.player, p.total as i64));
            (amounts.collect(), breakdown)
        }
        MeterCategory::DamageTaken => {
            let report = damage_taken(fight, filter);
            let breakdown = expanded(
                expand,
                &report.by_player,
                |p| p.player,
                |p| {
                    spell_entries(
                        p.abilities
                            .iter()
                            .map(|a| (a.spell, a.environmental, a.amount as i64)),
                    )
                },
            );
            let amounts = report.by_player.iter().map(|p| (p.player, p.amount as i64));
            (amounts.collect(), breakdown)
        }
        MeterCategory::HealingReceived => healing_received(fight, filter, expand),
        MeterCategory::Interrupts | MeterCategory::Dispels => {
            kicks(fight, filter, category, expand)
        }
    };
    let duration_ms = filter.duration_ms(fight);
    let rated = !matches!(category, MeterCategory::Interrupts | MeterCategory::Dispels);
    let mut rows: Vec<MeterRow> = amounts
        .into_iter()
        .filter(|&(player, amount)| {
            amount > 0 && fight.actors.get(player).kind == ActorKind::Player
        })
        .map(|(player, amount)| MeterRow {
            player,
            amount,
            per_second: if rated {
                per_second(amount as u64, duration_ms)
            } else {
                0.0
            },
        })
        .collect();
    rows.sort_by(|a, b| b.amount.cmp(&a.amount).then(a.player.cmp(&b.player)));
    let has_row = expand.is_some_and(|player| rows.iter().any(|row| row.player == player));
    let mut breakdown: Vec<MeterEntry> = if has_row {
        breakdown.into_iter().filter(|e| e.amount != 0).collect()
    } else {
        Vec::new()
    };
    breakdown.sort_by_key(|entry| Reverse(entry.amount));
    Meter {
        duration_ms,
        rows,
        breakdown,
    }
}

fn expanded<T>(
    expand: Option<ActorId>,
    players: &[T],
    player_of: impl Fn(&T) -> ActorId,
    split: impl Fn(&T) -> Vec<MeterEntry>,
) -> Vec<MeterEntry> {
    expand
        .and_then(|player| players.iter().find(|p| player_of(p) == player))
        .map_or_else(Vec::new, split)
}

fn ability_entries(rows: &[AbilityRow]) -> Vec<MeterEntry> {
    rows.iter()
        .map(|row| MeterEntry {
            key: MeterKey::Ability {
                spell: row.spell,
                actor: row.actor,
                kind: row.kind,
            },
            amount: row.amount,
        })
        .collect()
}

/// Summed by spell, in key order so equal amounts sort the same every time.
fn spell_entries(parts: impl Iterator<Item = (SpellId, bool, i64)>) -> Vec<MeterEntry> {
    let mut by_spell: BTreeMap<(SpellId, bool), i64> = BTreeMap::new();
    for (spell, environmental, amount) in parts {
        *by_spell.entry((spell, environmental)).or_default() += amount;
    }
    by_spell
        .into_iter()
        .map(|((spell, environmental), amount)| MeterEntry {
            key: MeterKey::Spell {
                spell,
                environmental,
            },
            amount,
        })
        .collect()
}

fn healer_of(event: &Event) -> ActorId {
    match event.kind {
        EventKind::Absorbed(absorbed) => absorbed.absorber,
        _ => event.source,
    }
}

fn healing_received(
    fight: &Fight,
    filter: &ReportFilter,
    expand: Option<ActorId>,
) -> (Vec<(ActorId, i64)>, Vec<MeterEntry>) {
    let mut amounts: BTreeMap<ActorId, i64> = BTreeMap::new();
    let mut by_healer: BTreeMap<ActorId, i64> = BTreeMap::new();
    for event in fight.events.iter().filter(|e| filter.contains(e.t)) {
        let Some(amount) = received_healing(event, event.target) else {
            continue;
        };
        *amounts.entry(event.target).or_default() += amount as i64;
        if expand == Some(event.target) {
            let healer = healer_of(event);
            let credited = fight.actors.credited_player(healer).unwrap_or(healer);
            *by_healer.entry(credited).or_default() += amount as i64;
        }
    }
    let breakdown = by_healer
        .into_iter()
        .map(|(healer, amount)| MeterEntry {
            key: MeterKey::Unit(healer),
            amount,
        })
        .collect();
    (amounts.into_iter().collect(), breakdown)
}

fn kicks(
    fight: &Fight,
    filter: &ReportFilter,
    category: MeterCategory,
    expand: Option<ActorId>,
) -> (Vec<(ActorId, i64)>, Vec<MeterEntry>) {
    let report = interrupts_report(fight, filter, &Scope::default(), Dimension::Source);
    let dispels = category == MeterCategory::Dispels;
    let amounts = report
        .rows
        .iter()
        .filter_map(|row| match row.key {
            RowKey::Unit(UnitRef::Player(player)) => {
                let count = if dispels { row.dispels } else { row.interrupts };
                Some((player, i64::from(count)))
            }
            _ => None,
        })
        .collect();
    let Some(player) = expand else {
        return (amounts, Vec::new());
    };
    let credited_to_player = |source| fight.actors.credited_player(source) == Some(player);
    let stopped: Vec<(SpellId, bool, i64)> = if dispels {
        report
            .dispels
            .iter()
            .filter(|d| credited_to_player(d.source))
            .map(|d| (d.removed, false, 1))
            .collect()
    } else {
        report
            .interrupts
            .iter()
            .filter(|i| credited_to_player(i.source))
            .map(|i| (i.interrupted, false, 1))
            .collect()
    };
    (amounts, spell_entries(stopped.into_iter()))
}
