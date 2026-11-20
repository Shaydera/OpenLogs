use std::collections::BTreeMap;

use openlogs_analysis::{ActorId, ActorKind, Fight, NOBODY, SpellId};
use openlogs_index::GameFlavor;

use crate::overview_dto::{PlayerRef, SpellRef, player_ref};

/// Collects the players and spell names a report mentions.
#[derive(Default)]
pub(crate) struct Refs {
    players: Vec<ActorId>,
    spells: BTreeMap<SpellId, SpellRef>,
}

impl Refs {
    pub(crate) fn player(&mut self, id: ActorId) -> ActorId {
        if !self.players.contains(&id) {
            self.players.push(id);
        }
        id
    }

    pub(crate) fn spell(&mut self, fight: &Fight, id: SpellId) -> SpellId {
        if let Some(info) = fight.spells.get(&id) {
            self.spells.entry(id).or_insert(SpellRef {
                name: info.name.clone(),
            });
        }
        id
    }

    pub(crate) fn finish(self, fight: &Fight) -> (Vec<PlayerRef>, BTreeMap<SpellId, SpellRef>) {
        (
            self.players
                .iter()
                .map(|&id| player_ref(fight, id))
                .collect(),
            self.spells,
        )
    }
}

/// The name the UI shows for a unit's `logged` name: a player's as its game shows it, any other
/// unit's as logged.
pub(crate) fn shown(fight: &Fight, id: ActorId, logged: &str) -> String {
    if fight.actors.get(id).kind == ActorKind::Player {
        GameFlavor::player_name(fight.flavor, logged)
    } else {
        logged.to_owned()
    }
}

/// The shown name; `None` when the log named nobody or a unit without a name.
pub(crate) fn shown_name(fight: &Fight, id: ActorId) -> Option<String> {
    if id == NOBODY {
        return None;
    }
    let logged = fight.actors.get(id).name.as_deref()?;
    Some(shown(fight, id, logged))
}

/// The logged name, or the GUID of a unit without a name.
pub(crate) fn logged_name(fight: &Fight, id: ActorId) -> &str {
    let actor = fight.actors.get(id);
    actor.name.as_deref().unwrap_or(&actor.guid)
}

/// The shown name, or the shown GUID of a unit without a name; `None` for nobody.
pub(crate) fn name_of(fight: &Fight, id: ActorId) -> Option<String> {
    (id != NOBODY).then(|| shown(fight, id, logged_name(fight, id)))
}

#[cfg(test)]
mod tests {
    use openlogs_analysis::Actors;

    use super::*;
    use crate::test_fight::{PLAYER_FLAGS, fight, unit};

    #[test]
    fn players_are_shown_by_their_game_and_other_units_as_logged() {
        let mut actors = Actors::new();
        let ravel = unit(
            &mut actors,
            "Player-1",
            "Ravel-Ashwood-Normal-EU",
            PLAYER_FLAGS,
        );
        let ward = unit(&mut actors, "Creature-0-1-1-1-9-01", "Ky-Veth Ward", 0xa18);
        let mut fight = fight(actors, Vec::new());
        fight.flavor = Some(GameFlavor::Forever);

        assert_eq!(player_ref(&fight, ravel).name, "Ravel Ashwood");
        assert_eq!(name_of(&fight, ravel).as_deref(), Some("Ravel Ashwood"));
        assert_eq!(name_of(&fight, ward).as_deref(), Some("Ky-Veth Ward"));
    }
}
