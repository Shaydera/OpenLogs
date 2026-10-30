use crate::actors::{ActorId, ActorKind, NOBODY};
use crate::fight::{Event, Fight, SpellId};
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
    /// Whether nothing is selected (the perspective aside).
    pub fn selects_all(&self) -> bool {
        self.source.is_empty() && self.target.is_empty() && self.ability.is_empty()
    }

    /// The selection of the units that died: source and ability belong to the killing blow.
    pub fn dead_side(&self) -> Scope {
        Scope {
            source: Vec::new(),
            ability: Vec::new(),
            ..self.clone()
        }
    }

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
        units(fight, &self.target, target) && self.accepts_any_target(fight, source, spell)
    }

    pub(crate) fn accepts_any_target(
        &self,
        fight: &Fight,
        source: Option<&UnitRef>,
        spell: Option<SpellId>,
    ) -> bool {
        units(fight, &self.source, source)
            && (self.ability.is_empty()
                || spell.is_some_and(|spell| self.ability.iter().any(|a| a.matches(fight, spell))))
    }
}

fn units(fight: &Fight, list: &[UnitRef], unit: Option<&UnitRef>) -> bool {
    list.is_empty() || unit.is_some_and(|unit| list.iter().any(|s| unit.is_in(fight, s)))
}

/// The side of `actor` at an event at `t` that logged it `hostile`: players and what they own are
/// always friendly; `None` for no unit (the environment).
pub fn side_of(fight: &Fight, actor: ActorId, hostile: bool, t: i32) -> Option<Side> {
    side_by(fight, actor, || fight.against_raid_at(actor, hostile, t))
}

/// The side of the event's source at the event.
pub(crate) fn source_side(fight: &Fight, event: &Event) -> Option<Side> {
    side_by(fight, event.source, || fight.source_against_raid(event))
}

/// The side of the event's target at the event.
pub(crate) fn target_side(fight: &Fight, event: &Event) -> Option<Side> {
    side_by(fight, event.target, || fight.target_against_raid(event))
}

/// The side of `actor` at an event; `None` when the event names it neither as source nor target.
pub(crate) fn side_at(fight: &Fight, event: &Event, actor: ActorId) -> Option<Side> {
    if actor == event.source {
        source_side(fight, event)
    } else if actor == event.target {
        target_side(fight, event)
    } else {
        None
    }
}

fn side_by(fight: &Fight, actor: ActorId, against_raid: impl FnOnce() -> bool) -> Option<Side> {
    if actor == NOBODY {
        return None;
    }
    let enemy = fight.actors.credited_player(actor).is_none() && against_raid();
    Some(if enemy { Side::Enemy } else { Side::Friendly })
}

/// Whether a view of `side` shows `unit`, which stands on `unit_side`: players for friendlies
/// (not their pets), units against the raid for enemies.
pub(crate) fn shown_on(fight: &Fight, side: Side, unit: ActorId, unit_side: Option<Side>) -> bool {
    match side {
        Side::Friendly => fight.actors.get(unit).kind == ActorKind::Player,
        Side::Enemy => unit_side == Some(Side::Enemy),
    }
}
