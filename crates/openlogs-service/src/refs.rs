use std::collections::BTreeMap;

use openlogs_analysis::{ActorId, Fight, NOBODY, SpellId};

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

pub(crate) fn name_of(fight: &Fight, id: ActorId) -> Option<String> {
    (id != NOBODY).then(|| {
        let actor = fight.actors.get(id);
        actor.name.clone().unwrap_or_else(|| actor.guid.clone())
    })
}
