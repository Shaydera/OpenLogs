use std::collections::VecDeque;

use crate::actors::NOBODY;
use crate::fight::{DamageVia, Event, EventKind, Fight, SpellId};

/// Takes part of a hit on the mage, who takes it later as Refraction damage.
pub(crate) const REFRACTIVE_IMAGES: SpellId = 1309497;

/// How much earlier than its hit the log may write the hit's absorb lines: in a crowded area hit
/// they can come several milliseconds before it.
const ABSORB_LINES_MS: i32 = 50;

/// Records what Refractive Images took of each hit, as loading does, for a fight built without
/// loading it. A hit's absorb lines come right before the victim's line of it, naming the same
/// attacker, target and spell; one that names no attacker while the hit does belongs to no hit.
/// A melee hit counts on its attacker-side line, so a landed copy's part goes there.
pub fn note_delayed_hits(fight: &mut Fight) {
    let mut absorbs: VecDeque<(usize, u64)> = VecDeque::new();
    let mut delayed: Vec<(u32, u64)> = Vec::new();
    for (index, event) in fight.events.iter().enumerate() {
        while absorbs
            .front()
            .is_some_and(|&(line, _)| event.t - fight.events[line].t > ABSORB_LINES_MS)
        {
            absorbs.pop_front();
        }
        match event.kind {
            EventKind::Absorbed(absorbed)
                if absorbed.absorb_spell == REFRACTIVE_IMAGES && absorbed.supporter == NOBODY =>
            {
                absorbs.push_back((index, absorbed.amount));
            }
            EventKind::Damage(_) | EventKind::Missed(_) if is_victim_line(event) => {
                let of_this_hit = |&(line, _): &(usize, u64)| same_hit(&fight.events[line], event);
                let amount: u64 = absorbs
                    .iter()
                    .filter(|a| of_this_hit(a))
                    .map(|&(_, a)| a)
                    .sum();
                if amount > 0 {
                    absorbs.retain(|a| !of_this_hit(a));
                    let hit = counted_line(event).unwrap_or(index);
                    delayed.extend(u32::try_from(hit).ok().map(|hit| (hit, amount)));
                }
            }
            _ => {}
        }
    }
    delayed.sort_unstable();
    delayed.dedup_by(|later, earlier| {
        let same = later.0 == earlier.0;
        if same {
            earlier.1 += later.1;
        }
        same
    });
    fight.delayed_hits = delayed;
}

fn same_hit(a: &Event, b: &Event) -> bool {
    a.source == b.source && a.target == b.target && a.spell == b.spell
}

fn is_victim_line(event: &Event) -> bool {
    match event.kind {
        EventKind::Damage(damage) => damage.supporter == NOBODY,
        EventKind::Missed(_) => true,
        _ => false,
    }
}

fn counted_line(event: &Event) -> Option<usize> {
    match event.kind {
        EventKind::Damage(damage) if damage.via == DamageVia::SwingLanded => {
            damage.attacker_line.map(|line| line as usize)
        }
        _ => None,
    }
}
