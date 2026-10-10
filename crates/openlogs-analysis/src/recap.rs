use std::collections::BTreeSet;

use openlogs_gamedata::{ConsumableKind, Curated};

use crate::actors::{ActorId, NOBODY};
use crate::auras::aura_intervals;
use crate::deaths::{Death, deaths, hp_pct};
use crate::fight::{AuraType, DamageVia, EventKind, Fight, SpellId};
use crate::filter::ReportFilter;
use crate::reports::taken::taken_amount;
use crate::usage::{
    ContextItem, ContextState, DeathContext, consumable_uses, death_context, defensive_uses,
};

/// HP curve and event window before a death.
pub const RECAP_WINDOW_MS: i32 = 8_000;
/// Without a lethal hit in the log, buffs up this long before the death count as active.
const BUFF_LOOKBACK_MS: i32 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecapKind {
    Damage,
    Heal,
    Absorb,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RecapEvent {
    pub t: i32,
    pub spell: SpellId,
    /// The attacker or healer; the absorber for absorbs.
    pub source: ActorId,
    pub kind: RecapKind,
    /// Damage including the shielded part, effective healing, or the absorbed amount.
    pub amount: u64,
    /// Damage only: the part a shield absorbed.
    pub absorbed: u64,
    /// Overkill for damage, overheal for heals.
    pub excess: u64,
    /// The player's HP after the event, when the log says.
    pub hp_pct: Option<f32>,
    /// Falling, lava, drowning and other world damage (spell 0, like melee).
    pub environmental: bool,
    /// A damage or heal over time tick (`SPELL_PERIODIC_*`).
    pub periodic: bool,
    /// The player behind a pet, guardian or totem source ("Mulgar (Totem)"); `NOBODY` otherwise.
    pub source_owner: ActorId,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DeathRecap {
    pub death: Death,
    /// 1-based position among all deaths of the pull.
    pub number: usize,
    pub context: Vec<DeathContext>,
    pub max_hp: Option<u64>,
    /// Damage, heals and absorbs on the player in the window, oldest first.
    pub events: Vec<RecapEvent>,
    /// HP percent snapshots in the window.
    pub hp: Vec<(i32, f32)>,
    /// Buffs on the player at the death: (spell, applying player or unit).
    pub buffs: Vec<(SpellId, ActorId)>,
}

pub fn death_recaps(fight: &Fight, curated: &Curated, filter: &ReportFilter) -> Vec<DeathRecap> {
    let all = deaths(fight);
    let consumables = consumable_uses(fight, curated);
    let defensives = defensive_uses(fight, curated);
    let auras = aura_intervals(fight);
    // The player credited for a pet, guardian or totem; players and enemies have none.
    let owner_of = |source: ActorId| {
        fight
            .actors
            .credited_player(source)
            .filter(|&player| player != source)
            .unwrap_or(NOBODY)
    };
    all.iter()
        .enumerate()
        .filter(|(_, death)| filter.contains(death.t))
        .map(|(index, death)| {
            let player = death.player;
            let start = (death.t - RECAP_WINDOW_MS).max(0);
            let first = fight.events.partition_point(|e| e.t < start);
            let end = fight.events.partition_point(|e| e.t <= death.t);
            let mut events = Vec::new();
            let mut hp = Vec::new();
            for event in &fight.events[first..end] {
                let hp_pct = event
                    .unit_hp
                    .filter(|h| h.actor == player && h.max > 0)
                    .map(hp_pct);
                if let Some(pct) = hp_pct {
                    hp.push((event.t, pct));
                }
                if event.target != player {
                    continue;
                }
                let recap = match event.kind {
                    EventKind::Heal(heal) if heal.supporter == NOBODY => Some(RecapEvent {
                        t: event.t,
                        spell: event.spell,
                        source: event.source,
                        kind: RecapKind::Heal,
                        amount: heal.amount.saturating_sub(heal.overheal),
                        absorbed: 0,
                        excess: heal.overheal,
                        hp_pct,
                        environmental: false,
                        periodic: heal.periodic,
                        source_owner: owner_of(event.source),
                    }),
                    EventKind::Absorbed(absorbed) if absorbed.supporter == NOBODY => {
                        Some(RecapEvent {
                            t: event.t,
                            spell: absorbed.absorb_spell,
                            source: absorbed.absorber,
                            kind: RecapKind::Absorb,
                            amount: absorbed.amount,
                            absorbed: 0,
                            excess: 0,
                            hp_pct,
                            environmental: false,
                            periodic: false,
                            source_owner: owner_of(absorbed.absorber),
                        })
                    }
                    _ => taken_amount(event).map(|(amount, absorbed)| RecapEvent {
                        t: event.t,
                        spell: event.spell,
                        source: event.source,
                        kind: RecapKind::Damage,
                        amount,
                        absorbed,
                        excess: match event.kind {
                            EventKind::Damage(damage) => damage.overkill,
                            _ => 0,
                        },
                        hp_pct,
                        environmental: match event.kind {
                            EventKind::Damage(damage) => damage.via == DamageVia::Environmental,
                            EventKind::Missed(missed) => missed.via == DamageVia::Environmental,
                            _ => false,
                        },
                        periodic: match event.kind {
                            EventKind::Damage(damage) => damage.via == DamageVia::Periodic,
                            EventKind::Missed(missed) => missed.via == DamageVia::Periodic,
                            _ => false,
                        },
                        source_owner: owner_of(event.source),
                    }),
                };
                events.extend(recap);
            }
            // 12.x removes every buff with the lethal hit, a few ms before UNIT_DIED; look
            // at the buffs up just before that hit.
            let reference = death
                .killing_blow
                .map_or(death.t - BUFF_LOOKBACK_MS, |hit| hit.t.min(death.t));
            let buffs: BTreeSet<(SpellId, ActorId)> = auras
                .iter()
                .filter(|i| {
                    i.target == player
                        && i.aura_type == AuraType::Buff
                        && i.start_ms < reference
                        && i.end_ms >= reference
                })
                .map(|i| {
                    (
                        i.spell,
                        fight.actors.credited_player(i.source).unwrap_or(i.source),
                    )
                })
                .collect();
            let mut context = death_context(fight, curated, death, &consumables, &defensives);
            // The recap always names the combat potion, even unused; the overview's context lists
            // it only while it runs.
            if !context.iter().any(|c| c.item == ContextItem::CombatPotion) {
                let last_potion = consumables
                    .iter()
                    .filter(|u| u.player == player && u.kind == ConsumableKind::CombatPotion)
                    .max_by_key(|u| u.t)
                    .map(|u| u.spell);
                context.push(DeathContext {
                    item: ContextItem::CombatPotion,
                    state: ContextState::Available,
                    spell: last_potion,
                });
            }
            DeathRecap {
                death: death.clone(),
                number: index + 1,
                context,
                max_hp: fight.actors.get(player).max_hp,
                events,
                hp,
                buffs: buffs.into_iter().collect(),
            }
        })
        .collect()
}
