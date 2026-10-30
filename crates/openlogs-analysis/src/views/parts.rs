use crate::actors::{ActorId, ActorKind, NOBODY};
use crate::cells::{CellKind, ScopeMetric};
use crate::fight::{DamageVia, Event, EventKind, Fight, MissType, NO_SPELL, SpellId};
use crate::filter::Overkill;
use crate::reports::taken::{damage_taken_amount, taken_amount};
use crate::reports::{Absorbs, Share, buffed_hit, damage_share, healing_share};
use crate::scope::Side;
use crate::timeline::{dealt_damage, healing_amount, hits_enemy};

/// The amount rule of Damage Done, Healing and Damage Taken from one side's point of view.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AmountFacts {
    /// Hits of players and their pets on hostile NPCs.
    DamageDone,
    /// Heals and absorbs of players and their pets on units that are not hostile.
    Healing,
    /// Damage players took; `hostile_sources_only` keeps what enemies did.
    Taken { hostile_sources_only: bool },
    /// Heals of hostile units on hostile units.
    EnemyHealing,
}

/// One amount an event books in a cell. A Reattributed support share books two: the Evoker's
/// credit and the deduction from the hit it was part of.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Part {
    pub source: ActorId,
    pub spell: SpellId,
    pub kind: CellKind,
    pub target: ActorId,
    pub amount: i64,
    /// The part of `amount` that went into or came from shields.
    pub absorbed: i64,
    /// Healing: the part of `amount` heal absorbs took.
    pub heal_absorbed: i64,
    /// Heals: the overheal of the logged heal, and what it healed before Aug support moved.
    pub overheal: i64,
    pub healed: i64,
    pub hit: bool,
    /// Healing: what the doer's own effect took back. It counts like a hit but is none.
    pub cost: bool,
    pub crit: bool,
    /// A periodic hit or miss, or a deduction from a periodic hit.
    pub periodic: bool,
    /// An attack that did no damage: no amount, no hit.
    pub miss: Option<MissType>,
    /// The logged hit the part belongs to; `None` for support no hit matches.
    pub row: Option<usize>,
}

impl AmountFacts {
    pub(crate) fn of(side: Side, metric: ScopeMetric) -> Option<Self> {
        match (side, metric) {
            (Side::Friendly, ScopeMetric::DamageDone) | (Side::Enemy, ScopeMetric::DamageTaken) => {
                Some(Self::DamageDone)
            }
            (Side::Friendly, ScopeMetric::Healing) => Some(Self::Healing),
            (Side::Friendly, ScopeMetric::DamageTaken) => Some(Self::Taken {
                hostile_sources_only: false,
            }),
            (Side::Enemy, ScopeMetric::DamageDone) => Some(Self::Taken {
                hostile_sources_only: true,
            }),
            (Side::Enemy, ScopeMetric::Healing) => Some(Self::EnemyHealing),
            _ => None,
        }
    }

    /// Calls `book` with every part the event at `index` books.
    pub(crate) fn parts(
        self,
        fight: &Fight,
        index: usize,
        reattributed: bool,
        overkill: Overkill,
        book: &mut impl FnMut(Part),
    ) {
        let event = &fight.events[index];
        match self {
            Self::DamageDone => match damage_share(fight, event, overkill) {
                None => damage_done_miss(fight, index, book),
                share => own_side(fight, index, share, reattributed, book),
            },
            Self::Healing => own_side(
                fight,
                index,
                healing_share(fight, event),
                reattributed,
                book,
            ),
            Self::Taken {
                hostile_sources_only,
            } => taken(fight, index, hostile_sources_only, overkill, book),
            Self::EnemyHealing => enemy_healing(fight, index, event, book),
        }
    }
}

fn own_side(
    fight: &Fight,
    index: usize,
    share: Option<Share>,
    reattributed: bool,
    book: &mut impl FnMut(Part),
) {
    let event = &fight.events[index];
    match share {
        Some(Share::Own {
            actor,
            spell,
            amount,
            overheal,
            critical,
            periodic,
            ..
        }) => {
            let absorbs = Absorbs::of(event);
            let healed = match event.kind {
                EventKind::Heal(_) => amount as i64,
                _ => 0,
            };
            book(Part {
                source: actor,
                spell,
                kind: CellKind::Own,
                target: event.target,
                amount: amount as i64,
                absorbed: absorbs.absorbed as i64,
                heal_absorbed: absorbs.heal_absorbed as i64,
                overheal: overheal as i64,
                healed,
                hit: true,
                cost: false,
                crit: critical,
                periodic,
                miss: None,
                row: Some(index),
            });
        }
        Some(Share::Cost {
            actor,
            spell,
            amount,
            ..
        }) => book(Part {
            source: actor,
            spell,
            kind: CellKind::Own,
            target: event.target,
            amount: -(amount as i64),
            absorbed: 0,
            heal_absorbed: 0,
            overheal: 0,
            healed: 0,
            hit: false,
            cost: true,
            crit: false,
            periodic: false,
            miss: None,
            row: Some(index),
        }),
        Some(Share::Support(support)) if reattributed => {
            let amount = support.amount as i64;
            let hit = buffed_hit(fight, index);
            let deducted = hit
                .map(|(hit, _)| Absorbs::of_part(&fight.events[hit], support.amount))
                .unwrap_or_default();
            let row = hit.map(|(hit, _)| listed_row(fight, hit));
            let periodic = hit.is_some_and(|(hit, _)| is_periodic(&fight.events[hit]));
            book(Part {
                source: support.evoker,
                spell: support.buff,
                kind: CellKind::Support,
                target: support.target,
                amount,
                absorbed: 0,
                heal_absorbed: 0,
                overheal: 0,
                healed: 0,
                hit: false,
                cost: false,
                crit: false,
                periodic: false,
                miss: None,
                row,
            });
            let (spell, kind) = match hit {
                Some((_, spell)) => (spell, CellKind::Own),
                None => (NO_SPELL, CellKind::Unmatched),
            };
            book(Part {
                source: support.doer,
                spell,
                kind,
                target: support.target,
                amount: -amount,
                absorbed: -(deducted.absorbed as i64),
                heal_absorbed: -(deducted.heal_absorbed as i64),
                overheal: 0,
                healed: 0,
                hit: false,
                cost: false,
                crit: false,
                periodic,
                miss: None,
                row,
            });
        }
        _ => {}
    }
}

/// The listed row of the hit at `index`. Melee support is logged after the hit's
/// SWING_DAMAGE_LANDED copy, which is listed as the attacker-side line it was paired with.
pub(crate) fn listed_row(fight: &Fight, index: usize) -> usize {
    match fight.events[index].kind {
        EventKind::Damage(damage) if damage.via == DamageVia::SwingLanded => {
            damage.attacker_line.map_or(index, |line| line as usize)
        }
        _ => index,
    }
}

/// The type of a logged attack that did no damage; a hit a shield swallowed is a hit.
pub(crate) fn missed_attack(event: &Event) -> Option<MissType> {
    match event.kind {
        EventKind::Missed(missed)
            if missed.miss_type != MissType::Absorb
                && !matches!(missed.via, DamageVia::SwingLanded | DamageVia::Split) =>
        {
            Some(missed.miss_type)
        }
        _ => None,
    }
}

fn is_periodic(event: &Event) -> bool {
    match event.kind {
        EventKind::Damage(damage) => damage.via == DamageVia::Periodic,
        EventKind::Missed(missed) => missed.via == DamageVia::Periodic,
        EventKind::Heal(heal) => heal.periodic,
        _ => false,
    }
}

fn miss_part(event: &Event, index: usize, miss: MissType) -> Part {
    Part {
        source: event.source,
        spell: event.spell,
        kind: CellKind::Own,
        target: event.target,
        amount: 0,
        absorbed: 0,
        heal_absorbed: 0,
        overheal: 0,
        healed: 0,
        hit: false,
        cost: false,
        crit: false,
        periodic: is_periodic(event),
        miss: Some(miss),
        row: Some(index),
    }
}

/// A player's or pet's attack on an enemy that did no damage.
fn damage_done_miss(fight: &Fight, index: usize, book: &mut impl FnMut(Part)) {
    let event = &fight.events[index];
    if let Some(miss) = missed_attack(event)
        && hits_enemy(fight, event)
        && fight.actors.credited_player(event.source).is_some()
    {
        book(miss_part(event, index, miss));
    }
}

fn taken(
    fight: &Fight,
    index: usize,
    hostile_sources_only: bool,
    overkill: Overkill,
    book: &mut impl FnMut(Part),
) {
    let event = &fight.events[index];
    // Enemies' damage done follows the overkill option; the raid's damage taken counts it all.
    let amounts = if hostile_sources_only {
        taken_amount(event, overkill)
    } else {
        damage_taken_amount(event)
    };
    let miss = missed_attack(event);
    if amounts.is_none() && miss.is_none() {
        return;
    }
    if fight.actors.get(event.target).kind != ActorKind::Player {
        return;
    }
    if hostile_sources_only && (event.source == NOBODY || !fight.source_against_raid(event)) {
        return;
    }
    if let Some((amount, absorbed)) = amounts {
        book(Part {
            source: event.source,
            spell: event.spell,
            kind: CellKind::Own,
            target: event.target,
            amount: amount as i64,
            absorbed: absorbed as i64,
            heal_absorbed: 0,
            overheal: 0,
            healed: 0,
            hit: true,
            cost: false,
            crit: dealt_damage(event).is_some_and(|damage| damage.critical),
            periodic: is_periodic(event),
            miss: None,
            row: Some(index),
        });
    } else if let Some(miss) = miss {
        book(miss_part(event, index, miss));
    }
}

/// Heals among units against the raid; heals on players and their pets are healing of their side.
fn enemy_healing(fight: &Fight, index: usize, event: &Event, book: &mut impl FnMut(Part)) {
    let EventKind::Heal(heal) = event.kind else {
        return;
    };
    if !fight.source_against_raid(event)
        || !fight.target_against_raid(event)
        || fight.actors.credited_player(event.target).is_some()
        || heal.supporter != NOBODY
    {
        return;
    }
    let amount = healing_amount(&heal) as i64;
    book(Part {
        source: event.source,
        spell: event.spell,
        kind: CellKind::Own,
        target: event.target,
        amount,
        absorbed: 0,
        heal_absorbed: heal.absorbed as i64,
        overheal: heal.overheal as i64,
        healed: amount,
        hit: true,
        cost: false,
        crit: heal.critical,
        periodic: heal.periodic,
        miss: None,
        row: Some(index),
    });
}
