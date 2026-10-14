use crate::actors::{ActorId, ActorKind, NOBODY};
use crate::fight::{Fight, SpellId};
use crate::links::{SpellKey, spell_key};

/// Which side a view is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Side {
    #[default]
    Friendly,
    Enemy,
}

/// A unit as rows and selections name it.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum UnitRef {
    /// A player; as a selection it includes the player's pets and guardians.
    Player(ActorId),
    /// A player's pets or guardians of one name.
    Pet { owner: ActorId, name: String },
    /// Every non-player unit of one name.
    Unit(String),
    /// One non-player unit.
    Instance(ActorId),
    /// No source (falling, lava, source-less debuffs).
    Environment,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum AbilityRef {
    /// Every spell ID logged under this name.
    Name(String),
    Id(SpellId),
}

/// Perspective and selections of a view; an empty list selects everything.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Scope {
    pub perspective: Side,
    pub source: Vec<UnitRef>,
    pub target: Vec<UnitRef>,
    pub ability: Vec<AbilityRef>,
}

pub fn unit_of(fight: &Fight, actor: ActorId) -> UnitRef {
    if actor == NOBODY {
        return UnitRef::Environment;
    }
    let unit = fight.actors.get(actor);
    if unit.kind == ActorKind::Player {
        return UnitRef::Player(actor);
    }
    match fight.actors.credited_player(actor) {
        Some(owner) => UnitRef::Pet {
            owner,
            name: unit.name.clone().unwrap_or_default(),
        },
        None => UnitRef::Instance(actor),
    }
}

impl UnitRef {
    pub fn is_in(&self, fight: &Fight, selected: &UnitRef) -> bool {
        match (selected, self) {
            (UnitRef::Player(player), UnitRef::Pet { owner, .. }) => player == owner,
            (UnitRef::Unit(name), UnitRef::Instance(id)) => {
                fight.actors.get(*id).name.as_deref() == Some(name.as_str())
            }
            (selected, unit) => selected == unit,
        }
    }

    /// How rows group the unit: pets with their owner, instances by name.
    pub fn grouped(&self, fight: &Fight) -> UnitRef {
        match self {
            UnitRef::Pet { owner, .. } => UnitRef::Player(*owner),
            UnitRef::Instance(id) => match &fight.actors.get(*id).name {
                Some(name) => UnitRef::Unit(name.clone()),
                None => self.clone(),
            },
            other => other.clone(),
        }
    }
}

impl AbilityRef {
    pub fn of(fight: &Fight, spell: SpellId) -> AbilityRef {
        match spell_key(fight, spell) {
            SpellKey::Name(name) => AbilityRef::Name(name.to_string()),
            SpellKey::Id(id) => AbilityRef::Id(id),
        }
    }

    pub fn matches(&self, fight: &Fight, spell: SpellId) -> bool {
        match self {
            AbilityRef::Id(id) => *id == spell,
            AbilityRef::Name(name) => {
                matches!(spell_key(fight, spell), SpellKey::Name(n) if n == name)
            }
        }
    }
}

impl Scope {
    pub fn wants(&self, fight: &Fight, source: &UnitRef, spell: SpellId, target: &UnitRef) -> bool {
        self.accepts(fight, Some(source), Some(spell), Some(target))
    }

    /// `None` is a part the log does not name (a death without a lethal hit, support no hit
    /// matches): it passes only while its dimension selects everything.
    pub fn accepts(
        &self,
        fight: &Fight,
        source: Option<&UnitRef>,
        spell: Option<SpellId>,
        target: Option<&UnitRef>,
    ) -> bool {
        let units = |list: &[UnitRef], unit: Option<&UnitRef>| {
            list.is_empty() || unit.is_some_and(|unit| list.iter().any(|s| unit.is_in(fight, s)))
        };
        units(&self.source, source)
            && units(&self.target, target)
            && (self.ability.is_empty()
                || spell.is_some_and(|spell| self.ability.iter().any(|a| a.matches(fight, spell))))
    }
}

/// The side of `actor` at an event that saw it `hostile`: players and what they own are always
/// friendly; `None` for no unit (the environment).
pub fn side_of(fight: &Fight, actor: ActorId, hostile: bool) -> Option<Side> {
    if actor == NOBODY {
        return None;
    }
    let enemy = hostile && fight.actors.credited_player(actor).is_none();
    Some(if enemy { Side::Enemy } else { Side::Friendly })
}
