use std::collections::HashMap;

use openlogs_parser::{NULL_GUID, Unit};

/// Index into [`Actors`]. [`NOBODY`] stands for an empty unit slot.
pub type ActorId = u32;
pub const NOBODY: ActorId = 0;

const TYPE_PET: u32 = 0x1000;
const TYPE_GUARDIAN: u32 = 0x2000;
/// Affiliation mine | party | raid.
const AFFILIATION_GROUP: u32 = 0x7;
const REACTION_HOSTILE: u32 = 0x40;
/// Owner chains longer than this are treated as broken (cycles, bad data).
const MAX_OWNER_DEPTH: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActorKind {
    Nobody,
    Player,
    /// Pets, guardians, totems and any NPC with a known owner.
    Pet,
    Npc,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Actor {
    pub id: ActorId,
    pub guid: String,
    pub name: Option<String>,
    pub kind: ActorKind,
    /// Latest unit flags seen for this actor.
    pub flags: u32,
    /// Direct owner (summoner) of a pet or guardian.
    pub owner: Option<ActorId>,
    /// From `COMBATANT_INFO`, players only.
    pub spec_id: Option<u32>,
    /// Largest item level the advanced block reported; players only.
    pub item_level: Option<u32>,
    /// Largest max HP the advanced block reported; players only.
    pub max_hp: Option<u64>,
}

impl Actor {
    pub fn is_hostile(&self) -> bool {
        self.flags & REACTION_HOSTILE != 0
    }

    /// Belongs to the logging player's group (mine, party or raid) and is not hostile.
    pub fn is_friendly(&self) -> bool {
        self.flags & AFFILIATION_GROUP != 0 && !self.is_hostile()
    }
}

/// Every unit seen in a fight, interned by GUID. Index 0 is [`NOBODY`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Actors {
    list: Vec<Actor>,
    by_guid: HashMap<String, ActorId>,
}

impl Default for Actors {
    fn default() -> Self {
        Self::new()
    }
}

impl Actors {
    pub fn new() -> Self {
        Self {
            list: vec![Actor {
                id: NOBODY,
                guid: NULL_GUID.to_string(),
                name: None,
                kind: ActorKind::Nobody,
                flags: 0,
                owner: None,
                spec_id: None,
                item_level: None,
                max_hp: None,
            }],
            by_guid: HashMap::new(),
        }
    }

    /// The same ids, GUIDs, names and kinds, without the facts that belong to one pull.
    pub fn carried_over(&self) -> Actors {
        let mut carried = self.clone();
        for actor in &mut carried.list {
            actor.flags = 0;
            actor.owner = None;
            actor.spec_id = None;
            actor.item_level = None;
            actor.max_hp = None;
        }
        carried
    }

    /// Id for `unit`, created on first sight; refreshes the name (if unknown) and flags.
    pub fn intern(&mut self, unit: &Unit<'_>) -> ActorId {
        if unit.is_empty() {
            return NOBODY;
        }
        let id = self.intern_guid(unit.guid);
        let actor = &mut self.list[id as usize];
        if actor.name.is_none() {
            actor.name = unit.name.map(str::to_string);
        }
        actor.flags = unit.flags;
        if actor.kind == ActorKind::Npc && unit.flags & (TYPE_PET | TYPE_GUARDIAN) != 0 {
            actor.kind = ActorKind::Pet;
        }
        id
    }

    /// Id for a bare GUID, e.g. an owner from the advanced logging block.
    pub fn intern_guid(&mut self, guid: &str) -> ActorId {
        if guid.is_empty() || guid == NULL_GUID {
            return NOBODY;
        }
        if let Some(&id) = self.by_guid.get(guid) {
            return id;
        }
        let id = self.list.len() as ActorId;
        self.list.push(Actor {
            id,
            guid: guid.to_string(),
            name: None,
            kind: kind_from_guid(guid),
            flags: 0,
            owner: None,
            spec_id: None,
            item_level: None,
            max_hp: None,
        });
        self.by_guid.insert(guid.to_string(), id);
        id
    }

    pub fn id(&self, guid: &str) -> Option<ActorId> {
        self.by_guid.get(guid).copied()
    }

    pub fn get(&self, id: ActorId) -> &Actor {
        &self.list[id as usize]
    }

    /// All actors except [`NOBODY`].
    pub fn iter(&self) -> impl Iterator<Item = &Actor> {
        self.list.iter().skip(1)
    }

    pub fn players(&self) -> impl Iterator<Item = &Actor> {
        self.iter().filter(|actor| actor.kind == ActorKind::Player)
    }

    pub fn len(&self) -> usize {
        self.list.len() - 1
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Records that `owner` summoned or controls `unit`. The first owner wins; players
    /// are never owned.
    pub fn set_owner(&mut self, unit: ActorId, owner: ActorId) {
        if unit == NOBODY || owner == NOBODY || unit == owner {
            return;
        }
        let actor = &mut self.list[unit as usize];
        if actor.kind == ActorKind::Player || actor.owner.is_some() {
            return;
        }
        actor.owner = Some(owner);
        if actor.kind == ActorKind::Npc {
            actor.kind = ActorKind::Pet;
        }
    }

    pub fn set_spec(&mut self, unit: ActorId, spec_id: u32) {
        if unit != NOBODY {
            self.list[unit as usize].spec_id = Some(spec_id);
        }
    }

    /// Records a player's item level and max HP from an advanced block, keeping the largest.
    pub fn note_advanced(&mut self, unit: ActorId, level: u32, max_hp: u64) {
        let actor = &mut self.list[unit as usize];
        if actor.kind != ActorKind::Player {
            return;
        }
        if level > 0 {
            actor.item_level = Some(actor.item_level.map_or(level, |l| l.max(level)));
        }
        if max_hp > 0 {
            actor.max_hp = Some(actor.max_hp.map_or(max_hp, |m| m.max(max_hp)));
        }
    }

    /// Top of the owner chain; the actor itself if it has no owner.
    pub fn root_owner(&self, id: ActorId) -> ActorId {
        let mut current = id;
        for _ in 0..MAX_OWNER_DEPTH {
            match self.list[current as usize].owner {
                Some(owner) if owner != id => current = owner,
                _ => break,
            }
        }
        current
    }

    /// The player credited for this actor's actions: itself, or the player at the top
    /// of its owner chain.
    pub fn credited_player(&self, id: ActorId) -> Option<ActorId> {
        let root = self.root_owner(id);
        (self.list[root as usize].kind == ActorKind::Player).then_some(root)
    }
}

fn kind_from_guid(guid: &str) -> ActorKind {
    if guid.starts_with("Player-") {
        ActorKind::Player
    } else if guid.starts_with("Pet-") {
        ActorKind::Pet
    } else {
        ActorKind::Npc
    }
}
