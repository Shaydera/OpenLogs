use std::collections::HashMap;

use crate::actors::{ActorId, NOBODY};
use crate::fight::{DamageVia, Event, EventKind, Fight, SpellId};
use crate::timeline::{counts_as_damage_done, damage_done_amount, hits_hostile_npc};

pub mod damage;
pub mod healing;
pub mod taken;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RowKind {
    /// Cast by the player.
    Own,
    /// Cast by one of the player's pets or guardians (`actor`).
    Pet,
    /// Reattributed mode: support the player's buffs added to others' hits.
    SupportGiven,
    /// Reattributed mode: support from `actor`'s buffs, removed from this player.
    SupportDeducted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AbilityRow {
    pub spell: SpellId,
    /// Caster for own and pet rows, the Evoker for support rows.
    pub actor: ActorId,
    pub kind: RowKind,
    /// Negative for deductions.
    pub amount: i64,
    pub overheal: u64,
    pub hits: u32,
    pub crits: u32,
    /// Largest single positive amount.
    pub max: u64,
    /// Periodic hits (DoT/HoT ticks).
    pub ticks: u32,
}

/// Accumulates ability rows keyed by (spell, actor, kind).
#[derive(Default)]
pub(crate) struct Rows(HashMap<(SpellId, ActorId, RowKind), AbilityRow>);

impl Rows {
    #[allow(clippy::too_many_arguments)]
    pub fn add(
        &mut self,
        spell: SpellId,
        actor: ActorId,
        kind: RowKind,
        amount: i64,
        overheal: u64,
        critical: bool,
        periodic: bool,
    ) {
        let row = self.0.entry((spell, actor, kind)).or_insert(AbilityRow {
            spell,
            actor,
            kind,
            amount: 0,
            overheal: 0,
            hits: 0,
            crits: 0,
            max: 0,
            ticks: 0,
        });
        row.amount += amount;
        row.overheal += overheal;
        row.hits += 1;
        row.crits += u32::from(critical);
        row.max = row.max.max(amount.max(0) as u64);
        row.ticks += u32::from(periodic);
    }

    pub fn into_sorted(self, include_support: bool) -> Vec<AbilityRow> {
        let mut rows: Vec<AbilityRow> = self
            .0
            .into_values()
            .filter(|row| include_support || matches!(row.kind, RowKind::Own | RowKind::Pet))
            .collect();
        rows.sort_by(|a, b| b.amount.cmp(&a.amount).then(a.spell.cmp(&b.spell)));
        rows
    }
}

pub(crate) fn per_second(total: u64, duration_ms: u64) -> f64 {
    if duration_ms == 0 {
        0.0
    } else {
        total as f64 * 1000.0 / duration_ms as f64
    }
}

pub(crate) fn sorted_by_amount<K: Ord + Copy>(map: HashMap<K, u64>) -> Vec<(K, u64)> {
    let mut entries: Vec<(K, u64)> = map.into_iter().collect();
    entries.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    entries
}

/// Pets and guardians of one player that share a name (every Wild Imp has its own GUID)
/// share ability rows; the first one seen labels the row.
#[derive(Default)]
pub(crate) struct PetNames<'a>(HashMap<(ActorId, &'a str), ActorId>);

impl<'a> PetNames<'a> {
    /// The actor whose row `actor`'s ability goes into; `player` itself stays as is.
    pub fn representative(&mut self, fight: &'a Fight, player: ActorId, actor: ActorId) -> ActorId {
        if actor == player {
            return actor;
        }
        match fight.actors.get(actor).name.as_deref() {
            Some(name) => *self.0.entry((player, name)).or_insert(actor),
            None => actor,
        }
    }
}

/// One event's contribution to the damage or healing report.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Share {
    /// Logged on `player`, done by `actor` (the player or one of its pets).
    Own {
        player: ActorId,
        actor: ActorId,
        spell: SpellId,
        amount: u64,
        overheal: u64,
        critical: bool,
        periodic: bool,
        /// Healing only: damage prevented by `actor`'s absorb.
        absorb: bool,
    },
    /// An Evoker's share inside `player`'s event; it moves to `evoker` when reattributed.
    Support {
        player: ActorId,
        evoker: ActorId,
        spell: SpellId,
        amount: u64,
    },
    /// An Evoker's share inside their own event; it cancels out in both modes.
    SelfSupport {
        player: ActorId,
        spell: SpellId,
        amount: u64,
    },
}

/// Damage done: hits on units that were hostile at the hit, credited through pets.
/// Support from an unknown or the player's own Evoker is not a share.
pub(crate) fn damage_share(fight: &Fight, event: &Event) -> Option<Share> {
    let EventKind::Damage(damage) = event.kind else {
        return None;
    };
    if !hits_hostile_npc(fight, event) {
        return None;
    }
    let player = fight.actors.credited_player(event.source)?;
    let amount = damage_done_amount(&damage);
    if damage.supporter == NOBODY {
        return counts_as_damage_done(&damage).then_some(Share::Own {
            player,
            actor: event.source,
            spell: event.spell,
            amount,
            overheal: 0,
            critical: damage.critical,
            periodic: damage.via == DamageVia::Periodic,
            absorb: false,
        });
    }
    let evoker = fight.actors.credited_player(damage.supporter)?;
    Some(if evoker == player {
        Share::SelfSupport {
            player,
            spell: event.spell,
            amount,
        }
    } else {
        Share::Support {
            player,
            evoker,
            spell: event.spell,
            amount,
        }
    })
}

/// Healing: effective heals and absorbs on targets that were not hostile at the event.
pub(crate) fn healing_share(fight: &Fight, event: &Event) -> Option<Share> {
    if event.target_hostile || event.target == NOBODY {
        return None;
    }
    let (doer, spell, amount, overheal, critical, periodic, absorb, supporter) = match event.kind {
        EventKind::Heal(heal) => (
            event.source,
            event.spell,
            heal.amount.saturating_sub(heal.overheal),
            heal.overheal,
            heal.critical,
            heal.periodic,
            false,
            heal.supporter,
        ),
        EventKind::Absorbed(absorbed) => (
            absorbed.absorber,
            absorbed.absorb_spell,
            absorbed.amount,
            0,
            false,
            false,
            true,
            absorbed.supporter,
        ),
        _ => return None,
    };
    let player = fight.actors.credited_player(doer)?;
    if supporter == NOBODY {
        return Some(Share::Own {
            player,
            actor: doer,
            spell,
            amount,
            overheal,
            critical,
            periodic,
            absorb,
        });
    }
    let evoker = fight.actors.credited_player(supporter)?;
    Some(if evoker == player {
        Share::SelfSupport {
            player,
            spell,
            amount,
        }
    } else {
        Share::Support {
            player,
            evoker,
            spell,
            amount,
        }
    })
}
