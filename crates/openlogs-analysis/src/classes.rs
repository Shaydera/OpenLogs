use std::collections::HashMap;

use openlogs_gamedata::SpellClasses;

use crate::actors::ActorId;
use crate::fight::{EventKind, Fight};

/// Gives each player without a known spec the class most of their own casts belong to. A tie,
/// or no cast of a class spell, leaves the class unset; casts by their pets do not count.
pub fn infer_classes(fight: &mut Fight, spell_classes: &SpellClasses) {
    let mut casts: HashMap<ActorId, HashMap<u32, u32>> = fight
        .actors
        .players()
        .filter(|player| player.spec_class().is_none())
        .map(|player| (player.id, HashMap::new()))
        .collect();
    for event in &fight.events {
        if event.kind != EventKind::CastSuccess {
            continue;
        }
        if let (Some(per_class), Some(class)) = (
            casts.get_mut(&event.source),
            spell_classes.class_of(event.spell),
        ) {
            *per_class.entry(class).or_default() += 1;
        }
    }
    for (player, per_class) in casts {
        fight.actors.set_class(player, most_cast(&per_class));
    }
}

fn most_cast(casts_per_class: &HashMap<u32, u32>) -> Option<u32> {
    let mut ranked: Vec<(u32, u32)> = casts_per_class
        .iter()
        .map(|(&class, &casts)| (casts, class))
        .collect();
    ranked.sort_unstable_by(|a, b| b.cmp(a));
    match ranked.as_slice() {
        [(first, _), (second, _), ..] if first == second => None,
        [(_, class), ..] => Some(*class),
        [] => None,
    }
}
