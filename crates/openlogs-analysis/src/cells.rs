use std::collections::HashMap;

use openlogs_gamedata::Curated;

use crate::actors::{ActorKind, NOBODY};
use crate::aura_report::book_auras;
use crate::breakdown::Dimension;
use crate::casts::{book_casts, presses};
use crate::deaths_report::book_deaths;
use crate::fight::{AuraType, Event, EventKind, Fight, NO_SPELL, SpellId};
use crate::filter::{Attribution, ReportFilter};
use crate::interrupts::book_kicks;
use crate::reports::taken::taken_amount;
use crate::reports::{Share, buffed_spell, damage_share, healing_share};
use crate::resources::book_resources;
use crate::scope::{Scope, Side, UnitRef, unit_of};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ScopeMetric {
    DamageDone,
    Healing,
    DamageTaken,
    Casts,
    /// Interrupts and dispels; the ability is the interrupted or removed spell.
    Interrupts,
    /// Auras by applier, aura and holder; the holder is the own side.
    Buffs,
    Debuffs,
    /// Deaths by the killing blow's source and spell; who died is the own side.
    Deaths,
    /// Power and health holders and what they gained by spell; no other side.
    Resources,
}

impl ScopeMetric {
    /// The dimension that holds the perspective's side.
    pub fn own(self) -> Dimension {
        match self {
            ScopeMetric::DamageTaken
            | ScopeMetric::Buffs
            | ScopeMetric::Debuffs
            | ScopeMetric::Deaths => Dimension::Target,
            ScopeMetric::DamageDone
            | ScopeMetric::Healing
            | ScopeMetric::Casts
            | ScopeMetric::Interrupts
            | ScopeMetric::Resources => Dimension::Source,
        }
    }

    /// The dimension that holds the side the perspective faces; `None` when the metric has none.
    pub fn other(self) -> Option<Dimension> {
        match (self, self.own()) {
            (ScopeMetric::Resources, _) => None,
            (_, Dimension::Target) => Some(Dimension::Source),
            _ => Some(Dimension::Target),
        }
    }

    /// The row groupings in fallback order: own side, ability, other side.
    pub fn groupings(self) -> &'static [Dimension] {
        match self {
            ScopeMetric::DamageTaken => &[Dimension::Target, Dimension::Ability, Dimension::Source],
            ScopeMetric::DamageDone | ScopeMetric::Healing | ScopeMetric::Interrupts => {
                &[Dimension::Source, Dimension::Ability, Dimension::Target]
            }
            ScopeMetric::Casts => &[Dimension::Source, Dimension::Ability],
            ScopeMetric::Buffs | ScopeMetric::Debuffs => &[Dimension::Target, Dimension::Ability],
            ScopeMetric::Deaths => &[],
            ScopeMetric::Resources => &[Dimension::Source],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum CellKind {
    Own,
    /// Reattributed: support an Evoker's buff added to someone's hit.
    Support,
    /// Reattributed: support taken off hits no ability could be matched to.
    Unmatched,
    /// A curated proc or passive trigger, not a press.
    Proc,
    /// A death without a lethal hit in the log: no source and no ability.
    Unattributed,
    /// A unit's power or health sample: no ability.
    State,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cell {
    pub source: UnitRef,
    pub spell: SpellId,
    pub kind: CellKind,
    pub target: UnitRef,
    pub amount: i64,
    /// Damage hits: the absorbed amount logged on them; 0 for healing and Aug support cells.
    pub absorbed: i64,
    pub hits: u32,
    pub crits: u32,
}

impl Cell {
    pub(crate) fn source(&self) -> Option<&UnitRef> {
        (self.kind != CellKind::Unattributed).then_some(&self.source)
    }

    /// Unmatched support is booked under `NO_SPELL` like melee but belongs to no ability.
    pub(crate) fn ability(&self) -> Option<SpellId> {
        (!matches!(
            self.kind,
            CellKind::Unmatched | CellKind::Unattributed | CellKind::State
        ))
        .then_some(self.spell)
    }

    /// No unit is no target: a cast without one, never a hit.
    pub(crate) fn target(&self) -> Option<&UnitRef> {
        (self.target != UnitRef::Environment).then_some(&self.target)
    }

    /// Whether the log names the cell's part in `dimension`.
    pub(crate) fn names(&self, dimension: Dimension) -> bool {
        match dimension {
            Dimension::Source => self.source().is_some(),
            Dimension::Ability => self.ability().is_some(),
            Dimension::Target => self.target().is_some(),
        }
    }
}

pub(crate) fn in_scope(scope: &Scope, fight: &Fight, cell: &Cell) -> bool {
    scope.accepts(fight, cell.source(), cell.ability(), cell.target())
}

type Key = (UnitRef, SpellId, CellKind, UnitRef);
pub(crate) type Facts = HashMap<Key, Acc>;

#[derive(Default)]
pub(crate) struct Acc {
    amount: i64,
    absorbed: i64,
    hits: u32,
    crits: u32,
}

pub(crate) fn book(map: &mut Facts, key: Key, amount: i64, absorbed: i64, hit: bool, crit: bool) {
    let acc = map.entry(key).or_default();
    acc.amount += amount;
    acc.absorbed += absorbed;
    acc.hits += u32::from(hit);
    acc.crits += u32::from(hit && crit);
}

/// Amounts of `metric` in the range, from `side`'s point of view. Selections are not applied here.
pub fn cells(
    fight: &Fight,
    curated: &Curated,
    filter: &ReportFilter,
    side: Side,
    metric: ScopeMetric,
) -> Vec<Cell> {
    let mut map = Facts::new();
    match (side, metric) {
        (Side::Friendly, ScopeMetric::DamageDone) | (Side::Enemy, ScopeMetric::DamageTaken) => {
            own_side(fight, filter, &mut map, false)
        }
        (Side::Friendly, ScopeMetric::Healing) => own_side(fight, filter, &mut map, true),
        (Side::Friendly, ScopeMetric::DamageTaken) => taken(fight, filter, &mut map, false),
        (Side::Enemy, ScopeMetric::DamageDone) => taken(fight, filter, &mut map, true),
        (Side::Enemy, ScopeMetric::Healing) => enemy_healing(fight, filter, &mut map),
        (_, ScopeMetric::Casts) => book_casts(
            fight,
            curated,
            &presses(fight, curated, filter, side),
            &mut map,
        ),
        (_, ScopeMetric::Interrupts) => book_kicks(fight, filter, side, &mut map),
        (_, ScopeMetric::Buffs) => book_auras(fight, filter, side, AuraType::Buff, &mut map),
        (_, ScopeMetric::Debuffs) => book_auras(fight, filter, side, AuraType::Debuff, &mut map),
        (_, ScopeMetric::Deaths) => book_deaths(fight, filter, side, &mut map),
        (_, ScopeMetric::Resources) => book_resources(fight, filter, side, &mut map),
    }
    into_cells(map)
}

pub(crate) fn into_cells(map: Facts) -> Vec<Cell> {
    let mut list: Vec<Cell> = map
        .into_iter()
        .filter(|(_, acc)| acc.amount != 0 || acc.hits > 0)
        .map(|((source, spell, kind, target), acc)| Cell {
            source,
            spell,
            kind,
            target,
            amount: acc.amount,
            absorbed: acc.absorbed,
            hits: acc.hits,
            crits: acc.crits,
        })
        .collect();
    list.sort_by(|a, b| {
        b.amount.cmp(&a.amount).then_with(|| {
            (&a.source, a.spell, a.kind, &a.target).cmp(&(&b.source, b.spell, b.kind, &b.target))
        })
    });
    list
}

fn own_side(fight: &Fight, filter: &ReportFilter, map: &mut HashMap<Key, Acc>, healing: bool) {
    let reattributed = filter.attribution == Attribution::Reattributed;
    for (index, event) in fight
        .events
        .iter()
        .enumerate()
        .filter(|(_, e)| filter.contains(e.t))
    {
        let share = if healing {
            healing_share(fight, event)
        } else {
            damage_share(fight, event)
        };
        match share {
            Some(Share::Own {
                actor,
                spell,
                amount,
                critical,
                ..
            }) => book(
                map,
                (
                    unit_of(fight, actor),
                    spell,
                    CellKind::Own,
                    unit_of(fight, event.target),
                ),
                amount as i64,
                logged_absorbed(event),
                true,
                critical,
            ),
            Some(Share::Support(support)) if reattributed => {
                let target = unit_of(fight, support.target);
                let amount = support.amount as i64;
                book(
                    map,
                    (
                        UnitRef::Player(support.evoker),
                        support.buff,
                        CellKind::Support,
                        target.clone(),
                    ),
                    amount,
                    0,
                    false,
                    false,
                );
                let (spell, kind) = match buffed_spell(fight, index) {
                    Some(spell) => (spell, CellKind::Own),
                    None => (NO_SPELL, CellKind::Unmatched),
                };
                book(
                    map,
                    (unit_of(fight, support.doer), spell, kind, target),
                    -amount,
                    0,
                    false,
                    false,
                );
            }
            _ => {}
        }
    }
}

fn logged_absorbed(event: &Event) -> i64 {
    match event.kind {
        EventKind::Damage(damage) => damage.absorbed as i64,
        _ => 0,
    }
}

fn taken(
    fight: &Fight,
    filter: &ReportFilter,
    map: &mut HashMap<Key, Acc>,
    hostile_sources_only: bool,
) {
    for event in fight.events.iter().filter(|e| filter.contains(e.t)) {
        let Some((amount, absorbed)) = taken_amount(event) else {
            continue;
        };
        if fight.actors.get(event.target).kind != ActorKind::Player {
            continue;
        }
        if hostile_sources_only && (event.source == NOBODY || !event.source_hostile) {
            continue;
        }
        let crit = matches!(event.kind, EventKind::Damage(d) if d.critical);
        book(
            map,
            (
                unit_of(fight, event.source),
                event.spell,
                CellKind::Own,
                UnitRef::Player(event.target),
            ),
            amount as i64,
            absorbed as i64,
            true,
            crit,
        );
    }
}

fn enemy_healing(fight: &Fight, filter: &ReportFilter, map: &mut HashMap<Key, Acc>) {
    for event in fight.events.iter().filter(|e| filter.contains(e.t)) {
        let EventKind::Heal(heal) = event.kind else {
            continue;
        };
        if !(event.source_hostile && event.target_hostile) || heal.supporter != NOBODY {
            continue;
        }
        let amount = heal.amount.saturating_sub(heal.overheal) as i64;
        book(
            map,
            (
                unit_of(fight, event.source),
                event.spell,
                CellKind::Own,
                unit_of(fight, event.target),
            ),
            amount,
            0,
            true,
            heal.critical,
        );
    }
}
