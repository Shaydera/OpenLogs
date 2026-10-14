use std::collections::HashMap;

use crate::actors::{ActorKind, NOBODY};
use crate::breakdown::Dimension;
use crate::fight::{Event, EventKind, Fight, NO_SPELL, SpellId};
use crate::filter::{Attribution, ReportFilter};
use crate::reports::taken::taken_amount;
use crate::reports::{Share, buffed_spell, damage_share, healing_share};
use crate::scope::{Scope, Side, UnitRef, unit_of};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ScopeMetric {
    DamageDone,
    Healing,
    DamageTaken,
}

impl ScopeMetric {
    /// The dimension that holds the perspective's side.
    pub fn own(self) -> Dimension {
        match self {
            ScopeMetric::DamageTaken => Dimension::Target,
            ScopeMetric::DamageDone | ScopeMetric::Healing => Dimension::Source,
        }
    }

    /// The dimension that holds the side the perspective faces; `None` when the metric has none.
    pub fn other(self) -> Option<Dimension> {
        Some(match self.own() {
            Dimension::Target => Dimension::Source,
            _ => Dimension::Target,
        })
    }

    /// The row groupings in fallback order: own side, ability, other side.
    pub fn groupings(self) -> &'static [Dimension] {
        match self {
            ScopeMetric::DamageTaken => &[Dimension::Target, Dimension::Ability, Dimension::Source],
            ScopeMetric::DamageDone | ScopeMetric::Healing => {
                &[Dimension::Source, Dimension::Ability, Dimension::Target]
            }
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
    /// Unmatched support is booked under `NO_SPELL` like melee but belongs to no ability.
    pub(crate) fn ability(&self) -> Option<SpellId> {
        (self.kind != CellKind::Unmatched).then_some(self.spell)
    }

    /// Whether the log names the cell's part in `dimension`.
    pub(crate) fn names(&self, dimension: Dimension) -> bool {
        dimension != Dimension::Ability || self.ability().is_some()
    }
}

pub(crate) fn in_scope(scope: &Scope, fight: &Fight, cell: &Cell) -> bool {
    scope.accepts(
        fight,
        Some(&cell.source),
        cell.ability(),
        Some(&cell.target),
    )
}

type Key = (UnitRef, SpellId, CellKind, UnitRef);

#[derive(Default)]
struct Acc {
    amount: i64,
    absorbed: i64,
    hits: u32,
    crits: u32,
}

fn book(map: &mut HashMap<Key, Acc>, key: Key, amount: i64, absorbed: i64, hit: bool, crit: bool) {
    let acc = map.entry(key).or_default();
    acc.amount += amount;
    acc.absorbed += absorbed;
    acc.hits += u32::from(hit);
    acc.crits += u32::from(hit && crit);
}

/// Amounts of `metric` in the range, from `side`'s point of view. Selections are not applied here.
pub fn cells(fight: &Fight, filter: &ReportFilter, side: Side, metric: ScopeMetric) -> Vec<Cell> {
    let mut map: HashMap<Key, Acc> = HashMap::new();
    match (side, metric) {
        (Side::Friendly, ScopeMetric::DamageDone) | (Side::Enemy, ScopeMetric::DamageTaken) => {
            own_side(fight, filter, &mut map, false)
        }
        (Side::Friendly, ScopeMetric::Healing) => own_side(fight, filter, &mut map, true),
        (Side::Friendly, ScopeMetric::DamageTaken) => taken(fight, filter, &mut map, false),
        (Side::Enemy, ScopeMetric::DamageDone) => taken(fight, filter, &mut map, true),
        (Side::Enemy, ScopeMetric::Healing) => enemy_healing(fight, filter, &mut map),
    }
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
