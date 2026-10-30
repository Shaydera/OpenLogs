use std::collections::VecDeque;
use std::iter::Peekable;

use crate::actors::ActorId;
use crate::fight::Fight;

/// How many of the latest enemy lines decide whether the logging player is turned. Some adds
/// stay hostile to the turned player, so a single line does not decide it.
const WINDOW: usize = 32;

/// The spans in which most of the latest lines of enemies logged them friendly: a mechanic
/// turned the logging player against the raid. `friendly_lines` are the `(t, unit)` lines that
/// logged an NPC-controlled unit friendly, sorted by `t`.
pub(crate) fn logger_turned_spans(
    fight: &Fight,
    friendly_lines: &[(i32, ActorId)],
) -> Vec<(i32, i32)> {
    let enemy: Vec<bool> = (0..=fight.actors.len() as ActorId)
        .map(|id| fight.actors.is_enemy(id))
        .collect();
    let mut friendly = friendly_lines
        .iter()
        .filter(|&&(_, unit)| enemy[unit as usize])
        .map(|&(t, _)| t)
        .peekable();
    if friendly.peek().is_none() {
        return Vec::new();
    }
    let hostile = fight
        .events
        .iter()
        .flat_map(|e| {
            [
                (e.t, e.source, e.source_hostile),
                (e.t, e.target, e.target_hostile),
            ]
        })
        .filter(|&(_, unit, hostile)| hostile && enemy[unit as usize])
        .map(|(t, ..)| t)
        .peekable();

    let mut spans = Vec::new();
    let mut window: VecDeque<(i32, bool)> = VecDeque::with_capacity(WINDOW);
    let mut friendly_in_window = 0;
    let mut open: Option<(i32, i32)> = None;
    for (t, is_friendly) in in_time_order(friendly, hostile) {
        if window.len() == WINDOW && window.pop_front().is_some_and(|(_, f)| f) {
            friendly_in_window -= 1;
        }
        window.push_back((t, is_friendly));
        if is_friendly {
            friendly_in_window += 1;
        }
        let turned = friendly_in_window * 2 > window.len();
        match (open.as_mut(), turned) {
            (None, true) => {
                let start = window.iter().find(|&&(_, f)| f).map_or(t, |&(t, _)| t);
                open = Some((start, t));
            }
            (Some(span), true) if is_friendly => span.1 = t,
            (Some(span), false) => {
                spans.push(*span);
                open = None;
            }
            _ => {}
        }
    }
    spans.extend(open);
    spans
}

/// Friendly (`true`) and hostile line times merged by time.
fn in_time_order(
    mut friendly: Peekable<impl Iterator<Item = i32>>,
    mut hostile: Peekable<impl Iterator<Item = i32>>,
) -> impl Iterator<Item = (i32, bool)> {
    std::iter::from_fn(move || match (friendly.peek(), hostile.peek()) {
        (Some(&f), Some(&h)) if f <= h => friendly.next().map(|t| (t, true)),
        (_, Some(_)) => hostile.next().map(|t| (t, false)),
        (Some(_), None) => friendly.next().map(|t| (t, true)),
        (None, None) => None,
    })
}
