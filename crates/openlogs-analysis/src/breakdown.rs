use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap};

use openlogs_gamedata::Curated;

use crate::cells::{
    Cell, CellKind, Misses, ScopeMetric, ability_casts, cast_in_scope, cells, in_scope,
};
use crate::fight::{Fight, SpellId};
use crate::filter::ReportFilter;
use crate::scope::{AbilityRef, Scope, UnitRef};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Dimension {
    Source,
    Ability,
    Target,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum RowKey {
    Unit(UnitRef),
    Ability {
        ability: AbilityRef,
        kind: CellKind,
        /// The name of the pets that cast it; `None` for what players cast themselves.
        pet: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BreakdownRow {
    pub key: RowKey,
    /// Ability rows: the ID with the largest amount (for the icon); 0 for unit rows.
    pub spell: SpellId,
    /// Ability rows: the amount of every ID in the row, for choosing `spell` over several pulls.
    pub by_spell: Vec<(SpellId, i64)>,
    /// Pet ability rows: the pets the amounts come from, one per owner.
    pub pets: Vec<UnitRef>,
    pub amount: i64,
    /// The part of `amount` that went into or came from shields.
    pub absorbed: i64,
    /// Healing: the part of `amount` heal absorbs took.
    pub heal_absorbed: i64,
    /// Heals: their overheal, and what they healed before Aug support moved.
    pub overheal: i64,
    pub healed: i64,
    pub hits: u32,
    pub crits: u32,
    /// Ability rows: melee swings, and the presses of the ability on top-level rows; 0 for unit
    /// rows.
    pub casts: u32,
    /// What the hits booked with their Aug deductions; Aug credit is no hit's.
    pub hit_amount: i64,
    pub ticks: u32,
    pub tick_amount: i64,
    pub misses: Misses,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Split {
    pub dimension: Dimension,
    pub rows: Vec<BreakdownRow>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupedRow {
    pub row: BreakdownRow,
    pub splits: Vec<Split>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Breakdown {
    pub group: Dimension,
    /// Dimensions the selected row can still be split by.
    pub side: Vec<Dimension>,
    pub total: i64,
    pub duration_ms: u64,
    pub rows: Vec<GroupedRow>,
}

fn narrowed(scope: &Scope, dimension: Dimension) -> bool {
    match dimension {
        Dimension::Source => !scope.source.is_empty(),
        Dimension::Ability => !scope.ability.is_empty(),
        Dimension::Target => !scope.target.is_empty(),
    }
}

pub fn effective_group(scope: &Scope, metric: ScopeMetric, wanted: Dimension) -> Dimension {
    if !narrowed(scope, wanted) {
        return wanted;
    }
    metric
        .groupings()
        .iter()
        .copied()
        .find(|d| !narrowed(scope, *d))
        .unwrap_or(wanted)
}

/// The dimensions a row of `group` can still be split by.
pub(crate) fn side_dimensions(
    scope: &Scope,
    metric: ScopeMetric,
    group: Dimension,
) -> Vec<Dimension> {
    metric
        .groupings()
        .iter()
        .copied()
        .filter(|d| *d != group && !narrowed(scope, *d))
        .collect()
}

pub(crate) fn key_of(
    fight: &Fight,
    cell: &Cell,
    dimension: Dimension,
    metric: ScopeMetric,
) -> RowKey {
    match dimension {
        Dimension::Source => RowKey::Unit(cell.source.grouped(fight)),
        Dimension::Target => RowKey::Unit(cell.target.grouped(fight)),
        Dimension::Ability => RowKey::Ability {
            ability: AbilityRef::of(fight, cell.spell),
            kind: cell.kind,
            pet: match &cell.source {
                UnitRef::Pet { name, .. }
                    if metric.splits_pet_abilities() && cell.ability().is_some() =>
                {
                    Some(name.clone())
                }
                _ => None,
            },
        },
    }
}

#[derive(Default)]
struct Acc {
    amount: i64,
    absorbed: i64,
    heal_absorbed: i64,
    overheal: i64,
    healed: i64,
    hits: u32,
    crits: u32,
    casts: u32,
    hit_amount: i64,
    ticks: u32,
    tick_amount: i64,
    misses: Misses,
    by_spell: BTreeMap<SpellId, i64>,
    pets: Vec<UnitRef>,
}

impl Acc {
    fn add(&mut self, cell: &Cell) {
        self.amount += cell.amount;
        self.absorbed += cell.absorbed;
        self.heal_absorbed += cell.heal_absorbed;
        self.overheal += cell.overheal;
        self.healed += cell.healed;
        self.hits += cell.hits;
        self.crits += cell.crits;
        self.ticks += cell.ticks;
        self.tick_amount += cell.tick_amount;
        self.misses.merge(&cell.misses);
        self.casts += cell.casts;
        if cell.kind != CellKind::Support {
            self.hit_amount += cell.amount;
        }
        *self.by_spell.entry(cell.spell).or_default() += cell.amount;
        if matches!(cell.source, UnitRef::Pet { .. }) && !self.pets.contains(&cell.source) {
            self.pets.push(cell.source.clone());
        }
    }

    /// `cast`: a cell of [`ability_casts`].
    fn add_casts(&mut self, cast: &Cell) {
        self.casts += cast.casts;
    }

    fn into_row(mut self, key: RowKey) -> BreakdownRow {
        let by_spell = match key {
            RowKey::Ability { .. } => self.by_spell.iter().map(|(&s, &a)| (s, a)).collect(),
            RowKey::Unit(_) => Vec::new(),
        };
        let pets = match key {
            RowKey::Ability { pet: Some(_), .. } => {
                self.pets.sort();
                self.pets
            }
            _ => Vec::new(),
        };
        BreakdownRow {
            by_spell,
            spell: match key {
                RowKey::Ability { .. } => self
                    .by_spell
                    .iter()
                    .max_by(|a, b| a.1.cmp(b.1).then(b.0.cmp(a.0)))
                    .map_or(0, |(spell, _)| *spell),
                RowKey::Unit(_) => 0,
            },
            pets,
            casts: match key {
                RowKey::Ability { .. } => self.casts,
                RowKey::Unit(_) => 0,
            },
            key,
            amount: self.amount,
            absorbed: self.absorbed,
            heal_absorbed: self.heal_absorbed,
            overheal: self.overheal,
            healed: self.healed,
            hits: self.hits,
            crits: self.crits,
            hit_amount: self.hit_amount,
            ticks: self.ticks,
            tick_amount: self.tick_amount,
            misses: self.misses,
        }
    }
}

fn by_amount(a: &BreakdownRow, b: &BreakdownRow) -> Ordering {
    b.amount.cmp(&a.amount).then_with(|| a.key.cmp(&b.key))
}

fn rows_of<'a>(
    fight: &Fight,
    list: impl Iterator<Item = &'a Cell>,
    dimension: Dimension,
    metric: ScopeMetric,
) -> Vec<BreakdownRow> {
    let mut map: HashMap<RowKey, Acc> = HashMap::new();
    for cell in list {
        map.entry(key_of(fight, cell, dimension, metric))
            .or_default()
            .add(cell);
    }
    let mut rows: Vec<BreakdownRow> = map
        .into_iter()
        .map(|(key, acc)| acc.into_row(key))
        .filter(ranked)
        .collect();
    rows.sort_by(by_amount);
    rows
}

pub fn breakdown(
    fight: &Fight,
    curated: &Curated,
    filter: &ReportFilter,
    scope: &Scope,
    metric: ScopeMetric,
    wanted: Dimension,
) -> Breakdown {
    let all = cells(fight, curated, filter, scope.perspective, metric);
    let casts = if effective_group(scope, metric, wanted) == Dimension::Ability {
        ability_casts(fight, curated, filter, scope.perspective, metric)
    } else {
        Vec::new()
    };
    group_cells(fight, filter, scope, metric, &all, &casts, wanted)
}

/// A unit that was only ever missed is no row; an ability that only missed is one.
fn ranked(row: &BreakdownRow) -> bool {
    matches!(row.key, RowKey::Ability { .. }) || row.amount != 0 || row.hits > 0
}

/// `all`: the metric's cells in the range, before the selections; `casts`: the presses of its
/// top-level ability rows, from [`ability_casts`].
pub(crate) fn group_cells(
    fight: &Fight,
    filter: &ReportFilter,
    scope: &Scope,
    metric: ScopeMetric,
    all: &[Cell],
    casts: &[Cell],
    wanted: Dimension,
) -> Breakdown {
    let group = effective_group(scope, metric, wanted);
    let side = side_dimensions(scope, metric, group);
    let mut total = 0;
    let mut buckets: HashMap<RowKey, Vec<&Cell>> = HashMap::new();
    for cell in all.iter().filter(|c| in_scope(scope, fight, c)) {
        total += cell.amount;
        buckets
            .entry(key_of(fight, cell, group, metric))
            .or_default()
            .push(cell);
    }
    let mut cast_buckets: HashMap<RowKey, Vec<&Cell>> = HashMap::new();
    for cast in casts.iter().filter(|c| cast_in_scope(scope, fight, c)) {
        cast_buckets
            .entry(key_of(fight, cast, group, metric))
            .or_default()
            .push(cast);
    }
    let mut rows: Vec<GroupedRow> = buckets
        .into_iter()
        .map(|(key, mine)| {
            let my_casts = cast_buckets.get(&key).map_or(&[][..], Vec::as_slice);
            let mut acc = Acc::default();
            for cell in &mine {
                acc.add(cell);
            }
            for cast in my_casts {
                acc.add_casts(cast);
            }
            let splits = side
                .iter()
                .map(|&dimension| Split {
                    dimension,
                    rows: rows_of(fight, mine.iter().copied(), dimension, metric),
                })
                .collect();
            GroupedRow {
                row: acc.into_row(key),
                splits,
            }
        })
        .filter(|grouped| ranked(&grouped.row))
        .collect();
    rows.sort_by(|a, b| by_amount(&a.row, &b.row));
    Breakdown {
        group,
        side,
        total,
        duration_ms: filter.duration_ms(fight),
        rows,
    }
}
