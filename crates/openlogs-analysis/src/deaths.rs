use std::collections::HashSet;

use crate::actors::{ActorId, ActorKind};
use crate::fight::{EventKind, Fight, SpellId};

/// Spells a dead player casts to revive themselves; they log no `SPELL_RESURRECT`.
const SELF_RESURRECTS: &[SpellId] = &[
    21169, // Reincarnation
];

#[derive(Debug, Clone, PartialEq)]
pub struct Death {
    pub player: ActorId,
    pub t: i32,
}

/// Player deaths from `ENCOUNTER_START` on, one per life.
pub fn deaths(fight: &Fight) -> Vec<Death> {
    let mut result: Vec<Death> = Vec::new();
    let mut dead: HashSet<ActorId> = HashSet::new();
    for event in &fight.events {
        // Damage and casts of a dead player still land (projectiles, queued casts); only a
        // snapshot with HP shows him alive.
        if let Some(hp) = event.unit_hp
            && hp.current > 0
        {
            dead.remove(&hp.actor);
        }
        let is_player = fight.actors.get(event.target).kind == ActorKind::Player;
        match event.kind {
            // Feign Death logs an "unconscious" death; the hunter is still alive.
            EventKind::Died { unconscious: false }
                if is_player && event.t >= 0 && dead.insert(event.target) =>
            {
                result.push(Death {
                    player: event.target,
                    t: event.t,
                });
            }
            EventKind::Resurrect if is_player => {
                dead.remove(&event.target);
            }
            EventKind::CastSuccess if SELF_RESURRECTS.contains(&event.spell) => {
                dead.remove(&event.source);
            }
            _ => {}
        }
    }
    result
}
