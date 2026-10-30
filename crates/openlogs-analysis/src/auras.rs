use std::collections::{HashMap, HashSet};

use crate::actors::ActorId;
use crate::fight::{AuraAction, AuraType, Event, EventKind, Fight, SpellId};
use crate::scope::{Side, side_of};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuraInterval {
    /// The unit that has the aura.
    pub target: ActorId,
    /// The unit that applied it.
    pub source: ActorId,
    pub spell: SpellId,
    pub aura_type: AuraType,
    pub start_ms: i32,
    pub end_ms: i32,
    /// The holder's hostile flag as logged by the event that opened the interval.
    pub target_logged_hostile: bool,
    /// The applier's hostile flag as logged by the event that opened the interval.
    pub source_logged_hostile: bool,
    /// When the event that opened it came, unclipped; `None` when it was up before the log slice.
    pub opened_ms: Option<i32>,
    /// When it was applied, refreshed or given a stack, unclipped, the opening event included.
    pub applied: Vec<i32>,
}

impl AuraInterval {
    /// Its applications in `[start, end)`, plus one when it was already up as `start` came.
    pub fn applications_in(&self, start: i32, end: i32) -> u32 {
        let in_range = self
            .applied
            .iter()
            .filter(|&&t| t >= start && t < end)
            .count();
        let carried = self.opened_ms.is_none_or(|t| t < start) && self.end_ms > start;
        in_range as u32 + u32::from(carried)
    }

    /// The holder's side when the interval opened.
    pub(crate) fn holder_side(&self, fight: &Fight) -> Option<Side> {
        side_of(
            fight,
            self.target,
            self.target_logged_hostile,
            self.start_ms,
        )
    }

    /// Whether the applier stood against the raid when the interval opened.
    pub(crate) fn applier_against_raid(&self, fight: &Fight) -> bool {
        fight.against_raid_at(self.source, self.source_logged_hostile, self.start_ms)
    }
}

type Key = (ActorId, SpellId, ActorId);
/// The holder's and the applier's hostile flags.
type Hostile = (bool, bool);

struct Open {
    start: i32,
    aura_type: AuraType,
    hostile: Hostile,
    opened_ms: Option<i32>,
    applied: Vec<i32>,
}

fn hostile(event: &Event) -> Hostile {
    (event.target_logged_hostile, event.source_logged_hostile)
}

fn counts_as_application(action: AuraAction) -> bool {
    matches!(
        action,
        AuraAction::Applied | AuraAction::Refresh | AuraAction::AppliedDose
    )
}

/// Aura intervals clipped to the pull `[0, duration]`. An aura whose first event is a
/// remove, refresh or dose change was active before the log slice; one still open at the
/// end lasts until the end.
pub fn aura_intervals(fight: &Fight) -> Vec<AuraInterval> {
    let mut spans = aura_spans(fight);
    spans.retain(|i| i.end_ms > i.start_ms);
    spans
}

/// [`aura_intervals`] plus the instants of auras applied and removed in one millisecond.
pub(crate) fn aura_spans(fight: &Fight) -> Vec<AuraInterval> {
    let end = fight.duration_ms.min(i32::MAX as u64) as i32;
    let mut open: HashMap<Key, Open> = HashMap::new();
    let mut seen: HashSet<Key> = HashSet::new();
    let mut out = Vec::new();
    for event in &fight.events {
        let EventKind::Aura {
            action, aura_type, ..
        } = event.kind
        else {
            continue;
        };
        let key = (event.target, event.spell, event.source);
        let first = seen.insert(key);
        match action {
            AuraAction::Applied
            | AuraAction::Refresh
            | AuraAction::AppliedDose
            | AuraAction::RemovedDose => {
                let up_before = first && action != AuraAction::Applied;
                let interval = open.entry(key).or_insert_with(|| Open {
                    start: if up_before { i32::MIN } else { event.t },
                    aura_type,
                    hostile: hostile(event),
                    opened_ms: (!up_before).then_some(event.t),
                    applied: Vec::new(),
                });
                if counts_as_application(action) {
                    interval.applied.push(event.t);
                }
            }
            // A break names the breaker as source, not the caster; the REMOVED that
            // follows ends the aura.
            AuraAction::Broken | AuraAction::BrokenSpell => {}
            AuraAction::Removed => {
                let unopened = |start: i32| Open {
                    start,
                    aura_type,
                    hostile: hostile(event),
                    opened_ms: (start != i32::MIN).then_some(start),
                    applied: Vec::new(),
                };
                let (key, interval) = match open.remove(&key) {
                    Some(interval) => (key, interval),
                    None => match sibling(fight, &open, key) {
                        Some(other) => match open.remove(&other) {
                            Some(interval) => (other, interval),
                            None => (other, unopened(event.t)),
                        },
                        None if first => (key, unopened(i32::MIN)),
                        None => continue,
                    },
                };
                push_clipped(&mut out, key, interval, event.t, end);
            }
        }
    }
    for (key, interval) in open {
        push_clipped(&mut out, key, interval, end, end);
    }
    out.sort_by_key(|i| (i.target, i.spell, i.source, i.start_ms));
    out
}

/// An open interval of the same aura on the same target from another pet or guardian of
/// the same player: Mirror Images apply and remove their Frostbolt under different GUIDs.
fn sibling(fight: &Fight, open: &HashMap<Key, Open>, (target, spell, source): Key) -> Option<Key> {
    let owner = fight
        .actors
        .credited_player(source)
        .filter(|&p| p != source)?;
    open.keys()
        .copied()
        .filter(|&(t, s, src)| {
            t == target
                && s == spell
                && src != source
                && fight.actors.credited_player(src) == Some(owner)
        })
        .min()
}

fn push_clipped(
    out: &mut Vec<AuraInterval>,
    (target, spell, source): Key,
    interval: Open,
    stop: i32,
    end: i32,
) {
    let (start_ms, end_ms) = (interval.start.max(0), stop.min(end));
    let instant = end_ms == start_ms && !interval.applied.is_empty();
    if end_ms > start_ms || instant {
        let (target_logged_hostile, source_logged_hostile) = interval.hostile;
        out.push(AuraInterval {
            target,
            source,
            spell,
            aura_type: interval.aura_type,
            start_ms,
            end_ms,
            target_logged_hostile,
            source_logged_hostile,
            opened_ms: interval.opened_ms,
            applied: interval.applied,
        });
    }
}

/// Length of the union of `intervals` inside `[start, end)`.
pub fn union_ms(intervals: &[(i32, i32)], start: i32, end: i32) -> u64 {
    merged(intervals, start, end)
        .iter()
        .map(|&(a, b)| (b - a) as u64)
        .sum()
}

/// The share of `[start, end)` in which any lane is up, and how many lanes are up on average
/// meanwhile; `None` when none is.
pub fn coverage(lanes: &[Vec<(i32, i32)>], start: i32, end: i32) -> Option<(f64, f64)> {
    let all: Vec<(i32, i32)> = lanes.concat();
    let up_ms = union_ms(&all, start, end);
    if up_ms == 0 {
        return None;
    }
    let held_ms: u64 = lanes.iter().map(|lane| union_ms(lane, start, end)).sum();
    Some((
        up_ms as f64 / f64::from(end - start),
        held_ms as f64 / up_ms as f64,
    ))
}

/// `intervals` clipped to `[start, end)` and merged where they overlap.
pub(crate) fn merged(intervals: &[(i32, i32)], start: i32, end: i32) -> Vec<(i32, i32)> {
    let mut clipped: Vec<(i32, i32)> = intervals
        .iter()
        .map(|&(a, b)| (a.max(start), b.min(end)))
        .filter(|(a, b)| b > a)
        .collect();
    clipped.sort_unstable();
    let mut out: Vec<(i32, i32)> = Vec::new();
    for (a, b) in clipped {
        match out.last_mut() {
            Some(last) if a <= last.1 => last.1 = last.1.max(b),
            _ => out.push((a, b)),
        }
    }
    out
}
