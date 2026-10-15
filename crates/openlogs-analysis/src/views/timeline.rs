use std::collections::HashMap;
use std::hash::Hash;

use crate::actors::ActorId;
use crate::auras::merged;
use crate::breakdown::{Dimension, RowKey, effective_group, key_of};
use crate::cells::{Cell, CellKind, ScopeMetric, in_scope};
use crate::fight::{EventKind, Fight, SpellId};
use crate::filter::ReportFilter;
use crate::links::{SpellKey, spell_key};
use crate::scope::Scope;
use crate::views::amounts::part_cell;
use crate::views::names::log_name;
use crate::views::parts::Part;
use crate::views::{Lane, LogLine, TimelineItem, Window};

/// A tooltip lists at most this many log lines; the rest are counted.
pub(crate) const LOG_LINES: usize = 12;

/// The lane dimension: the wanted one, else the first free one of the tab's groupings; `None`
/// when every dimension the tab could split by is narrowed to one value.
pub(crate) fn lane_axis(
    scope: &Scope,
    metric: ScopeMetric,
    wanted: Dimension,
) -> Option<Dimension> {
    let axis = if metric.groupings().is_empty() {
        metric.own()
    } else {
        effective_group(scope, metric, wanted)
    };
    let narrowed = match axis {
        Dimension::Source => !scope.source.is_empty(),
        Dimension::Ability => !scope.ability.is_empty(),
        Dimension::Target => !scope.target.is_empty(),
    };
    (!narrowed).then_some(axis)
}

/// The window clipped to the range; an empty window when they do not overlap.
pub(crate) fn clip(fight: &Fight, filter: &ReportFilter, window: Window) -> Window {
    let (start, end) = filter.clipped(fight);
    let start_ms = window.start_ms.clamp(start, end);
    Window {
        start_ms,
        end_ms: window.end_ms.clamp(start_ms, end),
    }
}

pub(crate) fn overlaps(window: Window, start: i32, end: Option<i32>) -> bool {
    start < window.end_ms && end.unwrap_or(start) >= window.start_ms
}

/// The log lines of an item, at most [`LOG_LINES`], and how many more there are.
pub(crate) fn log_lines(fight: &Fight, lines: &[usize]) -> (Vec<LogLine>, u32) {
    let shown = lines
        .iter()
        .take(LOG_LINES)
        .map(|&index| {
            let event = &fight.events[index];
            LogLine {
                t: event.t,
                event: log_name(event),
                spell: event.spell,
                stage: match event.kind {
                    EventKind::EmpowerEnd { stage } | EventKind::EmpowerInterrupt { stage } => {
                        Some(stage)
                    }
                    EventKind::Aura { stacks, .. } => stacks,
                    _ => None,
                },
                reason: match event.kind {
                    EventKind::CastFailed { reason } => Some(reason),
                    _ => None,
                },
            }
        })
        .collect();
    (shown, lines.len().saturating_sub(LOG_LINES) as u32)
}

struct LaneAcc {
    order: i64,
    lane: Lane,
}

/// Lanes keyed by the axis, ordered by their figure in the range.
pub(crate) struct Lanes {
    axis: Option<Dimension>,
    ids: HashMap<Option<RowKey>, usize>,
    lanes: Vec<LaneAcc>,
}

impl Lanes {
    pub(crate) fn new(axis: Option<Dimension>) -> Self {
        Self {
            axis,
            ids: HashMap::new(),
            lanes: Vec::new(),
        }
    }

    pub(crate) fn axis(&self) -> Option<Dimension> {
        self.axis
    }

    pub(crate) fn key(&self, fight: &Fight, cell: &Cell) -> Option<RowKey> {
        self.axis.map(|axis| key_of(fight, cell, axis))
    }

    /// The lane of `key`, made on first use.
    pub(crate) fn id(&mut self, key: Option<RowKey>) -> usize {
        if let Some(&id) = self.ids.get(&key) {
            return id;
        }
        self.lanes.push(LaneAcc {
            order: 0,
            lane: Lane {
                key: key.clone(),
                total: 0,
                tracks: 1,
                items: Vec::new(),
                power: Vec::new(),
                dead: Vec::new(),
            },
        });
        self.ids.insert(key, self.lanes.len() - 1);
        self.lanes.len() - 1
    }

    pub(crate) fn has(&self, key: &Option<RowKey>) -> bool {
        self.ids.contains_key(key)
    }

    pub(crate) fn lane(&mut self, key: Option<RowKey>) -> &mut Lane {
        let id = self.id(key);
        &mut self.lanes[id].lane
    }

    /// Adds to the lane's figure: it lists the lane and orders it.
    pub(crate) fn count_at(&mut self, id: usize, amount: i64) {
        let acc = &mut self.lanes[id];
        acc.lane.total += amount;
        acc.order += amount;
    }

    pub(crate) fn count(&mut self, fight: &Fight, cell: &Cell, amount: i64) {
        let id = self.id(self.key(fight, cell));
        self.count_at(id, amount);
    }

    /// Orders the lane by `order`, larger first, instead of by its figure.
    pub(crate) fn order(&mut self, key: Option<RowKey>, order: i64) {
        let id = self.id(key);
        self.lanes[id].order = order;
    }

    pub(crate) fn item_at(&mut self, id: usize, item: TimelineItem) {
        self.lanes[id].lane.items.push(item);
    }

    pub(crate) fn item(&mut self, fight: &Fight, cell: &Cell, item: TimelineItem) {
        let id = self.id(self.key(fight, cell));
        self.item_at(id, item);
    }

    pub(crate) fn into_lanes(self) -> Vec<Lane> {
        let mut lanes: Vec<(i64, Lane)> = self
            .lanes
            .into_iter()
            .map(|mut acc| {
                acc.lane
                    .items
                    .sort_by_key(|item| (item.start_ms, item.end_ms.unwrap_or(item.start_ms)));
                (acc.order, acc.lane)
            })
            .collect();
        lanes.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.key.cmp(&b.1.key)));
        lanes.into_iter().map(|(_, lane)| lane).collect()
    }
}

type PartKey = (ActorId, SpellId, CellKind, ActorId);

/// A part's lane key under the scope; the lane exists once something is counted or drawn in it.
pub(crate) struct KnownPart {
    key: Option<RowKey>,
    lane: Option<usize>,
}

impl KnownPart {
    pub(crate) fn lane(&mut self, lanes: &mut Lanes) -> usize {
        *self.lane.get_or_insert_with(|| lanes.id(self.key.clone()))
    }
}

/// Whether the scope keeps a part and which lane it counts in, worked out once per units, spell
/// and kind: a pull books hundreds of thousands of parts on a few thousand of these.
pub(crate) struct PartLanes<'a> {
    fight: &'a Fight,
    scope: &'a Scope,
    known: HashMap<PartKey, Option<KnownPart>>,
}

impl<'a> PartLanes<'a> {
    pub(crate) fn new(fight: &'a Fight, scope: &'a Scope) -> Self {
        Self {
            fight,
            scope,
            known: HashMap::new(),
        }
    }

    /// The part's lane key; `None` when the scope leaves the part out.
    pub(crate) fn known(&mut self, lanes: &Lanes, part: &Part) -> Option<&mut KnownPart> {
        let (fight, scope) = (self.fight, self.scope);
        self.known
            .entry((part.source, part.spell, part.kind, part.target))
            .or_insert_with(|| {
                let cell = part_cell(fight, part);
                (scope.selects_all() || in_scope(scope, fight, &cell)).then(|| KnownPart {
                    key: lanes.key(fight, &cell),
                    lane: None,
                })
            })
            .as_mut()
    }
}

/// Sub-tracks filled first fit: a group of bars goes into the first track where none of its bars
/// overlaps another's. Each track keeps its bars sorted and disjoint, so a check is a binary search.
#[derive(Default)]
struct Tracks {
    tracks: Vec<Vec<(i32, i32)>>,
}

impl Tracks {
    /// Places `bars`, sorted and merged, and returns their track.
    fn place(&mut self, bars: &[(i32, i32)]) -> u32 {
        let fits = |track: &Vec<(i32, i32)>| {
            bars.iter().all(|&(from, to)| {
                let next = track.partition_point(|&(_, end)| end <= from);
                track.get(next).is_none_or(|&(start, _)| start >= to)
            })
        };
        let at = match self.tracks.iter().position(fits) {
            Some(at) => at,
            None => {
                self.tracks.push(Vec::new());
                self.tracks.len() - 1
            }
        };
        let track = &mut self.tracks[at];
        for &bar in bars {
            let at = track.partition_point(|&(start, _)| start < bar.0);
            track.insert(at, bar);
        }
        at as u32
    }

    fn count(&self) -> u32 {
        self.tracks.len().max(1) as u32
    }
}

/// Sub-tracks for groups of bars in one lane: the group with the most covered time first, each
/// into the first track where none of its bars overlaps another's. Returns each group's track
/// and the number of tracks.
pub(crate) fn pack<K: Eq + Hash + Ord + Clone>(
    groups: &HashMap<K, Vec<(i32, i32)>>,
) -> (HashMap<K, u32>, u32) {
    let mut order: Vec<(&K, i64)> = groups
        .iter()
        .map(|(key, bars)| (key, bars.iter().map(|&(a, b)| i64::from(b - a)).sum()))
        .collect();
    order.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    let mut tracks = Tracks::default();
    let placed = order
        .into_iter()
        .map(|(key, _)| {
            let bars = merged(&groups[key], i32::MIN, i32::MAX);
            (key.clone(), tracks.place(&bars))
        })
        .collect();
    (placed, tracks.count())
}

/// Each spell's name as a number; the IDs of one name share it.
pub(crate) fn name_ids(fight: &Fight) -> HashMap<SpellId, u32> {
    let mut ids: HashMap<SpellKey<'_>, u32> = HashMap::new();
    fight
        .spells
        .keys()
        .map(|&spell| {
            let next = ids.len() as u32;
            (spell, *ids.entry(spell_key(fight, spell)).or_insert(next))
        })
        .collect()
}

/// Slots for units' spell names, found from a logged unit and spell ID. Indexes look one up for
/// every hit of a request: a short sorted list per unit is faster than hashing.
pub(crate) struct NameSlots {
    by_unit: Vec<Vec<(SpellId, usize)>>,
    len: usize,
}

impl NameSlots {
    /// A slot for each unit and spell name among `wanted`, numbered in order of first appearance;
    /// `names` is the fight's [`name_ids`].
    pub(crate) fn new(
        fight: &Fight,
        names: &HashMap<SpellId, u32>,
        wanted: impl IntoIterator<Item = (ActorId, SpellId)>,
    ) -> Self {
        let mut ids_of_name: HashMap<u32, Vec<SpellId>> = HashMap::new();
        for (&spell, &name) in names {
            ids_of_name.entry(name).or_default().push(spell);
        }
        let mut slots: HashMap<(ActorId, u32), usize> = HashMap::new();
        for (unit, spell) in wanted {
            if let Some(&name) = names.get(&spell) {
                let next = slots.len();
                slots.entry((unit, name)).or_insert(next);
            }
        }
        let mut by_unit: Vec<Vec<(SpellId, usize)>> = vec![Vec::new(); fight.actors.len() + 1];
        for (&(unit, name), &slot) in &slots {
            for &spell in &ids_of_name[&name] {
                by_unit[unit as usize].push((spell, slot));
            }
        }
        for spells in &mut by_unit {
            spells.sort_unstable();
        }
        Self {
            by_unit,
            len: slots.len(),
        }
    }

    pub(crate) fn len(&self) -> usize {
        self.len
    }

    pub(crate) fn has_unit(&self, unit: ActorId) -> bool {
        !self.by_unit[unit as usize].is_empty()
    }

    pub(crate) fn find(&self, unit: ActorId, spell: SpellId) -> Option<usize> {
        let spells = &self.by_unit[unit as usize];
        let at = spells.binary_search_by_key(&spell, |&(id, _)| id).ok()?;
        Some(spells[at].1)
    }
}

/// Spells in order of first appearance, each once.
pub(crate) fn first_seen(spells: impl Iterator<Item = SpellId>) -> Vec<SpellId> {
    let mut seen = Vec::new();
    for spell in spells {
        if !seen.contains(&spell) {
            seen.push(spell);
        }
    }
    seen
}
