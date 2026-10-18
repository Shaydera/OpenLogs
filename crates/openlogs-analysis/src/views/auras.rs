use std::collections::{HashMap, HashSet};

use crate::actors::ActorId;
use crate::aura_report::{holds, side_intervals};
use crate::auras::{AuraInterval, merged};
use crate::breakdown::{Dimension, RowKey};
use crate::cells::{Cell, CellKind, in_range, in_scope};
use crate::fight::{AuraAction, AuraType, EventKind, Fight, SpellId};
use crate::filter::ReportFilter;
use crate::scope::{AbilityRef, Scope, unit_of};
use crate::views::names::log_name;
use crate::views::timeline::{Lanes, log_lines, overlaps, pack};
use crate::views::{EventRow, ItemAmount, ItemKind, RowType, Sink, Summary, TimelineItem, Window};

/// Whether the scope keeps an aura of `applier` on `holder`.
pub(crate) fn aura_in_scope(
    fight: &Fight,
    scope: &Scope,
    applier: ActorId,
    spell: SpellId,
    holder: ActorId,
) -> bool {
    scope.selects_all()
        || in_scope(
            scope,
            fight,
            &Cell::scope_probe(fight, applier, spell, CellKind::Own, holder),
        )
}

/// Aura rows of `aura_type` on the side's holders: applied, removed (with what broke it),
/// refreshed and stack changes.
pub(crate) fn rows(
    fight: &Fight,
    filter: &ReportFilter,
    scope: &Scope,
    aura_type: AuraType,
    sink: &mut Sink,
) -> Summary {
    let mut broken: HashMap<(ActorId, SpellId), (i32, ActorId, SpellId)> = HashMap::new();
    for index in in_range(fight, filter) {
        let event = &fight.events[index];
        let EventKind::Aura {
            action,
            aura_type: kind,
            stacks,
            broken_by,
        } = event.kind
        else {
            continue;
        };
        if kind != aura_type || !holds(fight, event.target, event.target_hostile, scope.perspective)
        {
            continue;
        }
        let row_type = match action {
            AuraAction::Broken | AuraAction::BrokenSpell => {
                broken.insert(
                    (event.target, event.spell),
                    (event.t, event.source, broken_by),
                );
                continue;
            }
            AuraAction::Applied => RowType::Apply,
            AuraAction::Removed => RowType::Remove,
            AuraAction::Refresh => RowType::Refresh,
            AuraAction::AppliedDose => RowType::StackGained,
            AuraAction::RemovedDose => RowType::StackLost,
        };
        let by = match action {
            AuraAction::Removed => broken
                .remove(&(event.target, event.spell))
                .filter(|(t, _, _)| *t == event.t)
                .map(|(_, breaker, spell)| (breaker, spell)),
            _ => None,
        };
        if !aura_in_scope(fight, scope, event.source, event.spell, event.target) {
            continue;
        }
        sink.row(event.t, || {
            let mut row = EventRow::new(
                index,
                event.t,
                row_type,
                log_name(event),
                (event.source, event.spell, event.target),
            );
            row.aura_kind = Some(kind);
            row.stacks = stacks;
            row.by = by;
            row
        });
    }
    Summary::default()
}

/// The lane cell of an aura: applier, aura and holder.
pub(crate) fn aura_cell(fight: &Fight, interval: &AuraInterval) -> Cell {
    Cell::scope_probe(
        fight,
        interval.source,
        interval.spell,
        CellKind::Own,
        interval.target,
    )
}

/// The aura lines of the window's bars, by holder, aura and applier.
fn aura_lines(
    fight: &Fight,
    bars: &[&AuraInterval],
) -> HashMap<(ActorId, SpellId, ActorId), Vec<usize>> {
    let mut lines: HashMap<(ActorId, SpellId, ActorId), Vec<usize>> = HashMap::new();
    let (Some(from), Some(to)) = (
        bars.iter().map(|i| i.start_ms).min(),
        bars.iter().map(|i| i.end_ms).max(),
    ) else {
        return lines;
    };
    let wanted: HashSet<(ActorId, SpellId, ActorId)> =
        bars.iter().map(|i| (i.target, i.spell, i.source)).collect();
    let first = fight.events.partition_point(|e| e.t < from);
    for (offset, event) in fight.events[first..].iter().enumerate() {
        if event.t > to {
            break;
        }
        let key = (event.target, event.spell, event.source);
        if matches!(event.kind, EventKind::Aura { .. }) && wanted.contains(&key) {
            lines.entry(key).or_default().push(first + offset);
        }
    }
    lines
}

/// The bars of each aura on each holder in a lane, with the lane's cell for them.
type Uptime = HashMap<(Option<RowKey>, ActorId, SpellId), (Cell, Vec<(i32, i32)>)>;

/// A lane's bars by the aura (or holder) they belong to.
type BarGroups = HashMap<RowKey, Vec<(i32, i32)>>;

/// Aura bars in lanes: every interval in the window as an item with its log lines and highest
/// stack count, packed into sub-tracks over the whole range so panning keeps them in place.
/// `counted` adds the time each holder had each aura in the range to the lanes' figures, overlapping
/// bars counted once, as the table's uptime does.
pub(crate) fn place_bars(
    fight: &Fight,
    filter: &ReportFilter,
    intervals: &[AuraInterval],
    window: Window,
    lanes: &mut Lanes,
    counted: bool,
    amount: impl Fn(&AuraInterval) -> Option<ItemAmount>,
) {
    let (start, end) = filter.clipped(fight);
    let axis = lanes.axis();
    let group_of = |interval: &AuraInterval| match axis {
        Some(Dimension::Ability) => RowKey::Unit(unit_of(fight, interval.target)),
        _ => RowKey::Ability {
            ability: AbilityRef::of(fight, interval.spell),
            kind: CellKind::Own,
            pet: None,
        },
    };
    let mut groups: HashMap<Option<RowKey>, BarGroups> = HashMap::new();
    let mut up: Uptime = HashMap::new();
    for interval in intervals {
        let (a, b) = (interval.start_ms.max(start), interval.end_ms.min(end));
        if b <= a {
            continue;
        }
        let cell = aura_cell(fight, interval);
        if counted {
            up.entry((lanes.key(fight, &cell), interval.target, interval.spell))
                .or_insert_with(|| (cell.clone(), Vec::new()))
                .1
                .push((a, b));
        }
        groups
            .entry(lanes.key(fight, &cell))
            .or_default()
            .entry(group_of(interval))
            .or_default()
            .push((a, b));
    }
    for (cell, bars) in up.values() {
        let time: i32 = merged(bars, i32::MIN, i32::MAX)
            .iter()
            .map(|&(a, b)| b - a)
            .sum();
        lanes.count(fight, cell, i64::from(time));
    }
    let mut tracks: HashMap<Option<RowKey>, HashMap<RowKey, u32>> = HashMap::new();
    for (lane, lane_groups) in &groups {
        let (placed, count) = pack(lane_groups);
        lanes.lane(lane.clone()).tracks = count;
        tracks.insert(lane.clone(), placed);
    }
    let shown: Vec<&AuraInterval> = intervals
        .iter()
        .filter(|i| {
            overlaps(window, i.start_ms, Some(i.end_ms)) && i.end_ms > start && i.start_ms < end
        })
        .collect();
    let lines = aura_lines(fight, &shown);
    for interval in shown {
        let cell = aura_cell(fight, interval);
        let lane = lanes.key(fight, &cell);
        let key_lines = lines
            .get(&(interval.target, interval.spell, interval.source))
            .map_or(&[][..], Vec::as_slice);
        let first = key_lines.partition_point(|&i| fight.events[i].t < interval.start_ms);
        let own: Vec<usize> = key_lines[first..]
            .iter()
            .copied()
            .take_while(|&i| fight.events[i].t <= interval.end_ms)
            .collect();
        let mut item = TimelineItem::new(ItemKind::Aura, interval.start_ms, Some(interval.end_ms));
        item.source = interval.source;
        item.spell = interval.spell;
        item.target = interval.target;
        item.stacks = own
            .iter()
            .filter_map(|&i| match fight.events[i].kind {
                EventKind::Aura { stacks, .. } => stacks,
                _ => None,
            })
            .max();
        item.track = tracks
            .get(&lane)
            .and_then(|placed| placed.get(&group_of(interval)))
            .copied()
            .unwrap_or(0);
        item.amount = amount(interval);
        (item.log, item.log_more) = log_lines(fight, &own);
        lanes.item(fight, &cell, item);
    }
}

/// Buffs and Debuffs marks: the side's holders' auras of the kind as bars.
pub(crate) fn marks(
    fight: &Fight,
    filter: &ReportFilter,
    scope: &Scope,
    aura_type: AuraType,
    window: Window,
    lanes: &mut Lanes,
) {
    let intervals: Vec<AuraInterval> = side_intervals(fight, filter, scope.perspective, aura_type)
        .into_iter()
        .filter(|i| aura_in_scope(fight, scope, i.source, i.spell, i.target))
        .collect();
    place_bars(fight, filter, &intervals, window, lanes, true, |_| None);
}
