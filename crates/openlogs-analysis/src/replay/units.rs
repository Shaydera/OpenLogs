use std::collections::HashMap;

use openlogs_gamedata::spec;

use crate::actors::{ActorId, ActorKind};
use crate::fight::Fight;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnitKind {
    Player,
    /// Pets, guardians, totems and friendly NPCs.
    Pet,
    Boss,
    /// Hostile units no player owns, other than the bosses.
    Add,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplayUnit {
    pub actor: ActorId,
    pub name: String,
    pub kind: UnitKind,
    pub spec_id: Option<u32>,
    pub class_id: Option<u32>,
    pub owner: Option<ActorId>,
    /// Adds of one name are numbered from 1 in the order they were first positioned.
    pub add_number: Option<u32>,
}

/// The replay's units, and each actor's kind for the lookups of the other parts.
pub(super) struct Roster {
    pub units: Vec<ReplayUnit>,
    kinds: Vec<Option<UnitKind>>,
}

impl Roster {
    pub fn new(fight: &Fight, bosses: &[ActorId]) -> Self {
        let mut first_seen: HashMap<ActorId, usize> = HashMap::new();
        for sample in &fight.positions {
            let next = first_seen.len();
            first_seen.entry(sample.actor).or_insert(next);
        }
        let mut units: Vec<ReplayUnit> = fight
            .actors
            .iter()
            .filter(|actor| actor.kind == ActorKind::Player || first_seen.contains_key(&actor.id))
            .map(|actor| {
                let kind = if actor.kind == ActorKind::Player {
                    UnitKind::Player
                } else if bosses.contains(&actor.id) {
                    UnitKind::Boss
                } else if actor.is_hostile() && fight.actors.credited_player(actor.id).is_none() {
                    UnitKind::Add
                } else {
                    UnitKind::Pet
                };
                ReplayUnit {
                    actor: actor.id,
                    name: actor.name.clone().unwrap_or_default(),
                    kind,
                    spec_id: actor.spec_id,
                    class_id: actor.spec_id.and_then(spec).map(|spec| spec.class_id),
                    owner: actor.owner,
                    add_number: None,
                }
            })
            .collect();
        number_adds(&mut units, &first_seen);
        let mut kinds = vec![None; fight.actors.len() + 1];
        for unit in &units {
            kinds[unit.actor as usize] = Some(unit.kind);
        }
        Self { units, kinds }
    }

    pub fn kind(&self, actor: ActorId) -> Option<UnitKind> {
        self.kinds.get(actor as usize).copied().flatten()
    }
}

fn number_adds(units: &mut [ReplayUnit], first_seen: &HashMap<ActorId, usize>) {
    let mut adds: Vec<&mut ReplayUnit> = units
        .iter_mut()
        .filter(|unit| unit.kind == UnitKind::Add)
        .collect();
    adds.sort_by_key(|unit| first_seen.get(&unit.actor).copied());
    let mut per_name: HashMap<String, u32> = HashMap::new();
    for add in adds {
        let number = per_name.entry(add.name.clone()).or_default();
        *number += 1;
        add.add_number = Some(*number);
    }
}
