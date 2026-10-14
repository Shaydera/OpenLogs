use crate::actors::{ActorId, NOBODY};
use crate::deaths::{Hit, deaths};
use crate::deaths_report::{enemy_kills, parts};
use crate::fight::{EventKind, Fight, NO_SPELL};
use crate::filter::ReportFilter;
use crate::recap::{RecapKind, recap_event, recap_window};
use crate::scope::{Scope, Side, unit_of};
use crate::views::names::log_name;
use crate::views::{EventRow, RowType, Sink, Summary};

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
