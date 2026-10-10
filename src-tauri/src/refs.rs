use openlogs_analysis::{ActorId, Fight, NOBODY};

pub(crate) fn name_of(fight: &Fight, id: ActorId) -> Option<String> {
    (id != NOBODY).then(|| {
        let actor = fight.actors.get(id);
        actor.name.clone().unwrap_or_else(|| actor.guid.clone())
    })
}
