use std::collections::HashMap;

use openlogs_gamedata::Curated;

use crate::actors::ActorId;
use crate::aura_report::book_auras;
use crate::breakdown::Dimension;
use crate::casts::{book_casts, presses};
use crate::deaths_report::book_deaths;
use crate::fight::{AuraType, DamageVia, Event, EventKind, Fight, MissType, SpellId};
use crate::filter::{Attribution, ReportFilter};
use crate::interrupts::book_kicks;
use crate::resources::book_resources;
use crate::scope::{Scope, Side, UnitRef, unit_of};
use crate::views::parts::{AmountFacts, Part};

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
    /// The hits that were periodic ticks, and what they booked with their Aug deductions.
    pub ticks: u32,
    pub tick_amount: i64,
    pub misses: Misses,
    /// Melee swings, landed or not; presses in the cells of [`ability_casts`].
    pub casts: u32,
}

/// Attacks that did no damage, by type. A hit a shield swallowed completely is a hit.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Misses(Vec<(MissType, u32)>);

impl Misses {
    pub fn total(&self) -> u32 {
        self.0.iter().map(|(_, count)| count).sum()
    }

    /// In type order.
    pub fn by_type(&self) -> &[(MissType, u32)] {
        &self.0
    }

    pub fn add(&mut self, miss: MissType, count: u32) {
        match self.0.binary_search_by_key(&miss, |(t, _)| *t) {
            Ok(i) => self.0[i].1 += count,
            Err(i) => self.0.insert(i, (miss, count)),
        }
    }

    pub fn merge(&mut self, other: &Misses) {
        for &(miss, count) in &other.0 {
            self.add(miss, count);
        }
    }
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
            ticks: 0,
            tick_amount: 0,
            misses: Misses::default(),
            casts: 0,
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

/// A cast without a target (an area spell) passes any target selection.
pub(crate) fn cast_in_scope(scope: &Scope, fight: &Fight, cast: &Cell) -> bool {
    match cast.target() {
        Some(_) => in_scope(scope, fight, cast),
        None => scope.accepts_any_target(fight, cast.source(), cast.ability()),
    }
}

type Key = (UnitRef, SpellId, CellKind, UnitRef);
pub(crate) type Facts = HashMap<Key, Acc>;

#[derive(Default)]
pub(crate) struct Acc {
    amount: i64,
    absorbed: i64,
    hits: u32,
    crits: u32,
    ticks: u32,
    tick_amount: i64,
    misses: Misses,
    casts: u32,
}

impl Acc {
    fn add(&mut self, amount: i64, absorbed: i64, hit: bool, crit: bool) {
        self.amount += amount;
        self.absorbed += absorbed;
        self.hits += u32::from(hit);
        self.crits += u32::from(hit && crit);
    }
}

pub(crate) fn book(map: &mut Facts, key: Key, amount: i64, absorbed: i64, hit: bool, crit: bool) {
    map.entry(key).or_default().add(amount, absorbed, hit, crit);
}

fn book_part(map: &mut Facts, key: Key, part: &Part, swing: bool) {
    let acc = map.entry(key).or_default();
    acc.add(part.amount, part.absorbed, part.hit, part.crit);
    acc.casts += u32::from(swing && (part.hit || part.miss.is_some()));
    if part.periodic {
        acc.ticks += u32::from(part.hit);
        acc.tick_amount += part.amount;
    }
    if let Some(miss) = part.miss {
        acc.misses.add(miss, 1);
    }
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

/// The presses of the side that deals `metric`'s damage; none for healing. Melee has no presses:
/// its cells count swings.
pub(crate) fn ability_casts(
    fight: &Fight,
    curated: &Curated,
    filter: &ReportFilter,
    side: Side,
    metric: ScopeMetric,
) -> Vec<Cell> {
    let casters = match AmountFacts::of(side, metric) {
        Some(AmountFacts::DamageDone) => Side::Friendly,
        Some(AmountFacts::Taken { .. }) => Side::Enemy,
        _ => return Vec::new(),
    };
    let mut map = Facts::new();
    for event in presses(fight, curated, filter, casters) {
        let key = (
            unit_of(fight, event.source),
            event.spell,
            CellKind::Own,
            unit_of(fight, event.target),
        );
        map.entry(key).or_default().casts += 1;
    }
    into_cells(map)
}

fn book_amounts(fight: &Fight, filter: &ReportFilter, facts: AmountFacts, map: &mut Facts) {
    let reattributed = filter.attribution == Attribution::Reattributed;
    for index in in_range(fight, filter) {
        let swing = is_swing(&fight.events[index]);
        facts.parts(fight, index, reattributed, filter.overkill, &mut |part| {
            book_part(
                map,
                (
                    unit_of(fight, part.source),
                    part.spell,
                    part.kind,
                    unit_of(fight, part.target),
                ),
                &part,
                swing,
            )
        });
    }
}

/// Its landed copy is not a swing of its own.
fn is_swing(event: &Event) -> bool {
    match event.kind {
        EventKind::Damage(damage) => damage.via == DamageVia::Swing,
        EventKind::Missed(missed) => missed.via == DamageVia::Swing,
        _ => false,
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
        .filter(|(_, acc)| {
            acc.amount != 0 || acc.hits > 0 || acc.misses.total() > 0 || acc.casts > 0
        })
        .map(|((source, spell, kind, target), acc)| Cell {
            source,
            spell,
            kind,
            target,
            amount: acc.amount,
            absorbed: acc.absorbed,
            hits: acc.hits,
            crits: acc.crits,
            ticks: acc.ticks,
            tick_amount: acc.tick_amount,
            misses: acc.misses,
            casts: acc.casts,
        })
        .collect();
    list.sort_by(|a, b| {
        b.amount.cmp(&a.amount).then_with(|| {
            (&a.source, a.spell, a.kind, &a.target).cmp(&(&b.source, b.spell, b.kind, &b.target))
        })
    });
    list
}
