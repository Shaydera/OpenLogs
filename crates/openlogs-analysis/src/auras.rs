use std::collections::{HashMap, HashSet};

use crate::actors::ActorId;
use crate::fight::{AuraAction, AuraType, Event, EventKind, Fight, SpellId};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuraInterval {
    /// The unit that has the aura.
    pub target: ActorId,
    /// The unit that applied it.
    pub source: ActorId,
    pub spell: SpellId,
    pub aura_type: AuraType,
    pub start_ms: i32,
    pub end_ms: i32,
    /// The holder's hostile flag at the event that opened the interval.
    pub target_hostile: bool,
    /// The applier's hostile flag at the event that opened the interval.
    pub source_hostile: bool,
}

type Key = (ActorId, SpellId, ActorId);
/// The holder's and the applier's hostile flags.
type Hostile = (bool, bool);
/// An open interval: its start, aura type and hostile flags.
type Open = (i32, AuraType, Hostile);

fn hostile(event: &Event) -> Hostile {
    (event.target_hostile, event.source_hostile)
}

/// Aura intervals clipped to the pull `[0, duration]`. An aura whose first event is a
/// remove, refresh or dose change was active before the log slice; one still open at the
/// end lasts until the end.
pub fn aura_intervals(fight: &Fight) -> Vec<AuraInterval> {
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
            AuraAction::Applied => {
                open.entry(key)
                    .or_insert((event.t, aura_type, hostile(event)));
            }
            AuraAction::Refresh | AuraAction::AppliedDose | AuraAction::RemovedDose => {
                let start = if first { i32::MIN } else { event.t };
                open.entry(key)
                    .or_insert((start, aura_type, hostile(event)));
            }
            // A break names the breaker as source, not the caster; the REMOVED that
            // follows ends the aura.
            AuraAction::Broken | AuraAction::BrokenSpell => {}
            AuraAction::Removed => {
                let (key, start, hostile) = match open.remove(&key) {
                    Some((start, _, hostile)) => (key, start, hostile),
                    None => match sibling(fight, &open, key) {
                        Some(other) => match open.remove(&other) {
                            Some((start, _, hostile)) => (other, start, hostile),
                            None => (other, event.t, hostile(event)),
                        },
                        None if first => (key, i32::MIN, hostile(event)),
                        None => continue,
                    },
                };
                push_clipped(&mut out, key, (aura_type, hostile), start, event.t, end);
            }
        }
    }
    for (key, (start, aura_type, hostile)) in open {
        push_clipped(&mut out, key, (aura_type, hostile), start, end, end);
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
    (aura_type, (target_hostile, source_hostile)): (AuraType, Hostile),
    start: i32,
    stop: i32,
    end: i32,
) {
    let (start_ms, end_ms) = (start.max(0), stop.min(end));
    if end_ms > start_ms {
        out.push(AuraInterval {
            target,
            source,
            spell,
            aura_type,
            start_ms,
            end_ms,
            target_hostile,
            source_hostile,
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
