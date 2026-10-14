use std::cmp::Ordering;
use std::collections::HashMap;

use crate::cells::{Cell, CellKind, ScopeMetric, cells, in_scope};
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
    Ability { ability: AbilityRef, kind: CellKind },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BreakdownRow {
    pub key: RowKey,
    /// Ability rows: the ID with the largest amount (for the icon); 0 for unit rows.
    pub spell: SpellId,
    pub amount: i64,
    pub absorbed: i64,
    pub hits: u32,
    pub crits: u32,
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

pub(crate) fn key_of(fight: &Fight, cell: &Cell, dimension: Dimension) -> RowKey {
    match dimension {
        Dimension::Source => RowKey::Unit(cell.source.grouped(fight)),
        Dimension::Target => RowKey::Unit(cell.target.grouped(fight)),
        Dimension::Ability => RowKey::Ability {
            ability: AbilityRef::of(fight, cell.spell),
            kind: cell.kind,
        },
    }
}

#[derive(Default)]
struct Acc {
    amount: i64,
    absorbed: i64,
    hits: u32,
    crits: u32,
    by_spell: HashMap<SpellId, i64>,
}

impl Acc {
    fn add(&mut self, cell: &Cell) {
        self.amount += cell.amount;
        self.absorbed += cell.absorbed;
        self.hits += cell.hits;
        self.crits += cell.crits;
        *self.by_spell.entry(cell.spell).or_default() += cell.amount;
    }

    fn into_row(self, key: RowKey) -> BreakdownRow {
        BreakdownRow {
            spell: match key {
                RowKey::Ability { .. } => self
                    .by_spell
                    .iter()
                    .max_by(|a, b| a.1.cmp(b.1).then(b.0.cmp(a.0)))
                    .map_or(0, |(spell, _)| *spell),
                RowKey::Unit(_) => 0,
            },
            key,
            amount: self.amount,
            absorbed: self.absorbed,
            hits: self.hits,
            crits: self.crits,
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
) -> Vec<BreakdownRow> {
    let mut map: HashMap<RowKey, Acc> = HashMap::new();
    for cell in list {
        map.entry(key_of(fight, cell, dimension))
            .or_default()
            .add(cell);
    }
    let mut rows: Vec<BreakdownRow> = map
        .into_iter()
        .map(|(key, acc)| acc.into_row(key))
        .collect();
    rows.sort_by(by_amount);
    rows
}

pub fn breakdown(
    fight: &Fight,
    filter: &ReportFilter,
    scope: &Scope,
    metric: ScopeMetric,
    wanted: Dimension,
) -> Breakdown {
    let group = effective_group(scope, metric, wanted);
    let side = side_dimensions(scope, metric, group);
    let all = cells(fight, filter, scope.perspective, metric);
    let mut total = 0;
    let mut buckets: HashMap<RowKey, Vec<&Cell>> = HashMap::new();
    for cell in all.iter().filter(|c| in_scope(scope, fight, c)) {
        total += cell.amount;
        buckets
            .entry(key_of(fight, cell, group))
            .or_default()
            .push(cell);
    }
    let mut rows: Vec<GroupedRow> = buckets
        .into_iter()
        .map(|(key, mine)| {
            let mut acc = Acc::default();
            for cell in &mine {
                acc.add(cell);
            }
            let splits = side
                .iter()
                .map(|&dimension| Split {
                    dimension,
                    rows: rows_of(fight, mine.iter().copied(), dimension),
                })
                .collect();
            GroupedRow {
                row: acc.into_row(key),
                splits,
            }
        })
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
