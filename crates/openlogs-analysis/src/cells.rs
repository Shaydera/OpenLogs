use std::collections::HashMap;

use openlogs_gamedata::Curated;

use crate::actors::ActorId;
use crate::aura_report::book_auras;
use crate::breakdown::Dimension;
use crate::casts::{book_casts, presses};
use crate::deaths_report::book_deaths;
use crate::fight::{AuraType, Fight, SpellId};
use crate::filter::{Attribution, ReportFilter};
use crate::interrupts::book_kicks;
use crate::resources::book_resources;
use crate::scope::{Scope, Side, UnitRef, unit_of};
use crate::views::parts::AmountFacts;

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

    /// Whether ability rows keep a pet's amounts apart from its owner's. Interrupts and auras name
    /// the spell acted on, not the pet's own; casts count no pets.
    pub fn splits_pet_abilities(self) -> bool {
        matches!(
            self,
            ScopeMetric::DamageDone | ScopeMetric::Healing | ScopeMetric::DamageTaken
        )
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
    /// A cell with no amounts: what the scope and the lane keys read of a cell.
    pub(crate) fn scope_probe(
        fight: &Fight,
        source: ActorId,
        spell: SpellId,
        kind: CellKind,
        target: ActorId,
    ) -> Self {
        Self {
            source: unit_of(fight, source),
            spell,
            kind,
            target: unit_of(fight, target),
            amount: 0,
            absorbed: 0,
            hits: 0,
            crits: 0,
        }
    }

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
    if let Some(facts) = AmountFacts::of(side, metric) {
        book_amounts(fight, filter, facts, &mut map);
        return into_cells(map);
    }
    match metric {
        ScopeMetric::Casts => book_casts(
            fight,
            curated,
            &presses(fight, curated, filter, side),
            &mut map,
        ),
        ScopeMetric::Interrupts => book_kicks(fight, filter, side, &mut map),
        ScopeMetric::Buffs => book_auras(fight, filter, side, AuraType::Buff, &mut map),
        ScopeMetric::Debuffs => book_auras(fight, filter, side, AuraType::Debuff, &mut map),
        ScopeMetric::Deaths => book_deaths(fight, filter, side, &mut map),
        ScopeMetric::Resources => book_resources(fight, filter, side, &mut map),
        ScopeMetric::DamageDone | ScopeMetric::Healing | ScopeMetric::DamageTaken => {
            unreachable!("both sides of the amount metrics have amount facts")
        }
    }
    into_cells(map)
}

fn book_amounts(fight: &Fight, filter: &ReportFilter, facts: AmountFacts, map: &mut Facts) {
    let reattributed = filter.attribution == Attribution::Reattributed;
    for index in in_range(fight, filter) {
        facts.parts(fight, index, reattributed, filter.overkill, &mut |part| {
            book(
                map,
                (
                    unit_of(fight, part.source),
                    part.spell,
                    part.kind,
                    unit_of(fight, part.target),
                ),
                part.amount,
                part.absorbed,
                part.hit,
                part.crit,
            )
        });
    }
}

/// Indices of the events in the range.
pub(crate) fn in_range(fight: &Fight, filter: &ReportFilter) -> std::ops::Range<usize> {
    let first = fight.events.partition_point(|e| e.t < filter.start_ms);
    let end = fight.events.partition_point(|e| e.t < filter.end_ms);
    first..end.max(first)
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
