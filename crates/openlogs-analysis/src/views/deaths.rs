use std::collections::HashMap;

use crate::actors::{ActorId, NOBODY};
use crate::breakdown::RowKey;
use crate::cells::{Cell, CellKind};
use crate::deaths::{Hit, deaths};
use crate::deaths_report::{enemy_kills, parts};
use crate::fight::{EventKind, Fight, NO_SPELL};
use crate::filter::ReportFilter;
use crate::recap::{RecapKind, recap_event, recap_start, recap_window};
use crate::scope::{Scope, Side, unit_of};
use crate::views::names::log_name;
use crate::views::timeline::{Lanes, overlaps};
use crate::views::{EventRow, ItemKind, RowType, Sink, Summary, TimelineItem, Window};

/// The `UNIT_DIED` line of `unit`'s death at `t`.
fn died_index(fight: &Fight, unit: ActorId, t: i32) -> Option<usize> {
    let first = fight.events.partition_point(|e| e.t < t);
    fight.events[first..]
        .iter()
        .take_while(|e| e.t == t)
        .position(|e| e.target == unit && matches!(e.kind, EventKind::Died { unconscious: false }))
        .map(|i| first + i)
}

fn died_row(
    index: usize,
    t: i32,
    event: &'static str,
    dead: ActorId,
    blow: Option<Hit>,
) -> EventRow {
    let (source, spell) = blow.map_or((NOBODY, NO_SPELL), |hit| (hit.source, hit.spell));
    let mut row = EventRow::new(index, t, RowType::Died, event, (source, spell, dead));
    row.amount = blow.map(|hit| hit.overkill);
    row.unknown_blow = blow.is_none();
    row.environmental = blow.is_some_and(|hit| hit.environmental);
    row
}

/// A recap event before the death at `death`, as a context row.
fn recap_row(fight: &Fight, index: usize, player: ActorId, death: usize) -> Option<EventRow> {
    let event = &fight.events[index];
    let recap = recap_event(fight, event, player)?;
    let mut row = EventRow::new(
        index,
        event.t,
        RowType::Recap,
        log_name(event),
        (recap.source, recap.spell, player),
    );
    row.amount = Some(recap.amount);
    row.absorbed = recap.absorbed;
    match recap.kind {
        RecapKind::Damage => row.overkill = recap.excess,
        RecapKind::Heal => row.overheal = recap.excess,
        RecapKind::Absorb => row.by = Some((event.source, event.spell)),
    }
    row.target_hp = event
        .unit_hp
        .filter(|hp| hp.actor == player)
        .map(|hp| (hp.current, hp.max));
    row.environmental = recap.environmental;
    row.context_of = Some(death);
    Some(row)
}

/// Deaths: friendlies with the recap events before each death as context rows, enemies as kills
/// with their time alive. Source and ability match the killing blow.
pub(crate) fn rows(
    fight: &Fight,
    filter: &ReportFilter,
    scope: &Scope,
    sink: &mut Sink,
) -> Summary {
    let accepts = |blow: Option<Hit>, dead: ActorId| {
        let (source, spell) = parts(fight, blow);
        scope.accepts(fight, source.as_ref(), spell, Some(&unit_of(fight, dead)))
    };
    match scope.perspective {
        Side::Friendly => {
            for death in deaths(fight)
                .into_iter()
                .filter(|d| filter.contains(d.t) && accepts(d.killing_blow, d.player))
            {
                let Some(index) = died_index(fight, death.player, death.t) else {
                    continue;
                };
                sink.group(death.t, || {
                    let mut rows: Vec<EventRow> = recap_window(fight, death.t)
                        .filter_map(|i| recap_row(fight, i, death.player, index))
                        .collect();
                    rows.push(died_row(
                        index,
                        death.t,
                        "UNIT_DIED",
                        death.player,
                        death.killing_blow,
                    ));
                    rows
                });
            }
        }
        Side::Enemy => {
            let mut unlogged = fight.events.len();
            for kill in enemy_kills(fight, filter)
                .into_iter()
                .filter(|k| accepts(k.killing_blow, k.unit))
            {
                let (index, event) = match died_index(fight, kill.unit, kill.t) {
                    Some(index) => (index, "UNIT_DIED"),
                    None => {
                        unlogged += 1;
                        (unlogged - 1, "ENCOUNTER_END")
                    }
                };
                sink.row(kill.t, || {
                    let mut row = died_row(index, kill.t, event, kill.unit, kill.killing_blow);
                    row.alive_ms = kill.alive_ms;
                    row
                });
            }
        }
    }
    Summary::default()
}

/// Deaths marks: friendlies' deaths with their recap window as a band, enemies' kills with their
/// time alive, one lane per unit (enemies per name), the earliest death first.
pub(crate) fn marks(
    fight: &Fight,
    filter: &ReportFilter,
    scope: &Scope,
    window: Window,
    lanes: &mut Lanes,
) {
    let accepts = |blow: Option<Hit>, dead: ActorId| {
        let (source, spell) = parts(fight, blow);
        scope.accepts(fight, source.as_ref(), spell, Some(&unit_of(fight, dead)))
    };
    let marks: Vec<TimelineItem> = match scope.perspective {
        Side::Friendly => deaths(fight)
            .into_iter()
            .filter(|d| filter.contains(d.t) && accepts(d.killing_blow, d.player))
            .map(|death| {
                let mut item = death_item(
                    death.player,
                    death.t,
                    Some(recap_start(death.t)),
                    death.killing_blow,
                );
                item.rezzed_ms = death.resurrected_at;
                item
            })
            .collect(),
        Side::Enemy => enemy_kills(fight, filter)
            .into_iter()
            .filter(|k| accepts(k.killing_blow, k.unit))
            .map(|kill| {
                let mut item = death_item(kill.unit, kill.t, None, kill.killing_blow);
                item.alive_ms = kill.alive_ms;
                item
            })
            .collect(),
    };
    let mut first: HashMap<Option<RowKey>, i32> = HashMap::new();
    for item in marks {
        let cell = death_cell(fight, &item);
        let at = item.end_ms.unwrap_or(item.start_ms);
        lanes.count(fight, &cell, 1);
        let key = lanes.key(fight, &cell);
        let earliest = first.entry(key).or_insert(at);
        *earliest = (*earliest).min(at);
        if overlaps(window, item.start_ms, item.end_ms) {
            lanes.item(fight, &cell, item);
        }
    }
    for (key, t) in first {
        lanes.order(key, -i64::from(t));
    }
}

/// The lane cell of a death: the killing blow's source and spell, the dead unit.
pub(crate) fn death_cell(fight: &Fight, item: &TimelineItem) -> Cell {
    Cell {
        source: unit_of(fight, item.by.map_or(NOBODY, |(source, _)| source)),
        spell: item.by.map_or(NO_SPELL, |(_, spell)| spell),
        kind: CellKind::Own,
        target: unit_of(fight, item.target),
        amount: 0,
        absorbed: 0,
        hits: 0,
        crits: 0,
    }
}

/// A death at `t`; with `band_from`, the recap window from then to the death.
pub(crate) fn death_item(
    dead: ActorId,
    t: i32,
    band_from: Option<i32>,
    blow: Option<Hit>,
) -> TimelineItem {
    let mut item = match band_from {
        Some(from) => TimelineItem::new(ItemKind::Death, from, Some(t)),
        None => TimelineItem::new(ItemKind::Death, t, None),
    };
    item.target = dead;
    item.by = blow.map(|hit| (hit.source, hit.spell));
    item.overkill = blow.map(|hit| hit.overkill);
    item
}
