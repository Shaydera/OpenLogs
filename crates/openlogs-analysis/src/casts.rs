use std::collections::{HashMap, HashSet};

use openlogs_gamedata::Curated;

use crate::actors::ActorId;
use crate::fight::{Event, EventKind, Fight, SpellId};
use crate::links::{SpellKey, spell_key};

/// A cast that comes at most this long after a counted cast of the same name with another ID is
/// part of that press (Exterminate's second swing 0.5 s later, Flame Shock's and Verdant Embrace's
/// two IDs within 25 ms, The Hunt's impact 0.45–0.65 s later). Separate presses of two IDs of one
/// name come later (Reaver's Glaive's two IDs ≥ 1.02 s apart in 12.x logs).
const SAME_PRESS_MS: i32 = 1_000;
/// A cast ID that only ever comes right after a cast of another ID of its name, at most this long
/// after it, is that press's follow-up (Frostwyrm's Fury's 1265384, 2.0–8.0 s after every 279302).
const FOLLOW_UP_MS: i32 = 10_000;

/// Indices into `fight.events` of `player`'s follow-up casts: casts of spells that log
/// several IDs per press after the press itself. Curated procs are not looked at (the player and
/// ability pages drop them, see `non_press_casts`).
/// Counts are presses on the player page and the ability page.
fn follow_up_casts(fight: &Fight, curated: &Curated, player: ActorId) -> HashSet<usize> {
    let mut skip = HashSet::new();
    let mut by_name: HashMap<(ActorId, SpellKey<'_>), Vec<usize>> = HashMap::new();
    for (i, event) in fight.events.iter().enumerate() {
        if matches!(event.kind, EventKind::CastSuccess)
            && event.source == player
            && !curated.is_proc(event.spell)
        {
            by_name
                .entry((event.source, spell_key(fight, event.spell)))
                .or_default()
                .push(i);
        }
    }
    let at = |i: usize| &fight.events[i];
    for casts in by_name.values() {
        let ids: HashSet<SpellId> = casts.iter().map(|&i| at(i).spell).collect();
        if ids.len() < 2 {
            continue;
        }
        let is_follow_up = |id: SpellId| {
            casts.iter().enumerate().all(|(k, &i)| {
                at(i).spell != id
                    || k > 0 && {
                        let previous = at(casts[k - 1]);
                        previous.spell != id && at(i).t - previous.t <= FOLLOW_UP_MS
                    }
            })
        };
        let follow_ups: HashSet<SpellId> =
            ids.iter().copied().filter(|&id| is_follow_up(id)).collect();
        let mut last: Option<&Event> = None;
        for &i in casts {
            let event = at(i);
            let same_press =
                last.is_some_and(|l| l.spell != event.spell && event.t - l.t <= SAME_PRESS_MS);
            if follow_ups.contains(&event.spell) || same_press {
                skip.insert(i);
            } else {
                last = Some(event);
            }
        }
    }
    skip
}

/// Indices into `fight.events` of `player`'s own casts that are no press of their own: curated
/// procs and the follow-up casts of spells that log several IDs per press.
pub(crate) fn non_press_casts(fight: &Fight, curated: &Curated, player: ActorId) -> HashSet<usize> {
    let mut skip = follow_up_casts(fight, curated, player);
    skip.extend(fight.events.iter().enumerate().filter_map(|(i, event)| {
        (matches!(event.kind, EventKind::CastSuccess)
            && event.source == player
            && curated.is_proc(event.spell))
        .then_some(i)
    }));
    skip
}
