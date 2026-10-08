use std::collections::HashMap;

use openlogs_gamedata::{ConsumableKind, CooldownCategory, Curated};

use crate::actors::ActorId;
use crate::deaths::Death;
use crate::fight::{EventKind, Fight, SpellId};

/// Repeated casts of one cooldown within this window are a single use.
pub const REPEAT_WINDOW_MS: i32 = 5_000;
/// A consumable or defensive used this shortly before a death counts as "used".
pub const RECENT_USE_MS: i32 = 10_000;
const WARLOCK_CLASS_ID: u32 = 9;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConsumableUse {
    pub player: ActorId,
    pub t: i32,
    pub spell: SpellId,
    pub kind: ConsumableKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CooldownUse {
    pub player: ActorId,
    pub t: i32,
    pub spell: SpellId,
    pub category: CooldownCategory,
    pub duration_ms: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DefensiveUse {
    pub player: ActorId,
    pub t: i32,
    pub spell: SpellId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextItem {
    Healthstone,
    HealthPotion,
    /// The player's combat potion while its cooldown runs at the death.
    CombatPotion,
    Defensive(SpellId),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextState {
    Used {
        t: i32,
    },
    OnCooldown {
        used_at: i32,
    },
    Available,
    /// A personal defensive not used once before the death although its cooldown had passed
    /// since the pull started: it would have been ready again.
    NeverUsed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DeathContext {
    pub item: ContextItem,
    pub state: ContextState,
    /// The stone or potion whose use sets the state; `None` otherwise.
    pub spell: Option<SpellId>,
}

/// Successful casts by players (directly or through their pets): (time, player, spell).
fn player_casts(fight: &Fight) -> impl Iterator<Item = (i32, ActorId, SpellId)> + '_ {
    fight.events.iter().filter_map(|event| {
        if event.kind != EventKind::CastSuccess {
            return None;
        }
        let player = fight.actors.credited_player(event.source)?;
        Some((event.t, player, event.spell))
    })
}

fn spell_name(fight: &Fight, spell: SpellId) -> &str {
    fight
        .spells
        .get(&spell)
        .map_or("", |info| info.name.as_str())
}

fn spec_of(fight: &Fight, player: ActorId) -> Option<u32> {
    fight.actors.get(player).spec_id
}

pub fn consumable_uses(fight: &Fight, curated: &Curated) -> Vec<ConsumableUse> {
    player_casts(fight)
        .filter_map(|(t, player, spell)| {
            let kind = curated.consumable_kind(spell, spell_name(fight, spell))?;
            Some(ConsumableUse {
                player,
                t,
                spell,
                kind,
            })
        })
        .collect()
}

pub fn cooldown_uses(fight: &Fight, curated: &Curated) -> Vec<CooldownUse> {
    let mut last: HashMap<(ActorId, &str), i32> = HashMap::new();
    let mut uses = Vec::new();
    for (t, player, spell) in player_casts(fight) {
        let Some(entry) = curated.cooldown(spell, spec_of(fight, player)) else {
            continue;
        };
        let key = (player, entry.name.as_str());
        if last
            .get(&key)
            .is_some_and(|&previous| t - previous < REPEAT_WINDOW_MS)
        {
            continue;
        }
        last.insert(key, t);
        uses.push(CooldownUse {
            player,
            t,
            spell,
            category: entry.category,
            duration_ms: entry.duration_s * 1_000,
        });
    }
    uses
}

pub fn defensive_uses(fight: &Fight, curated: &Curated) -> Vec<DefensiveUse> {
    player_casts(fight)
        .filter(|&(_, player, spell)| {
            spec_of(fight, player)
                .is_some_and(|spec_id| curated.defensive(spell, spec_id).is_some())
        })
        .map(|(t, player, spell)| DefensiveUse { player, t, spell })
        .collect()
}

fn state(last_use: Option<i32>, death_t: i32, cooldown_ms: i32) -> ContextState {
    match last_use {
        Some(t) if death_t - t <= RECENT_USE_MS => ContextState::Used { t },
        Some(t) if death_t - t < cooldown_ms => ContextState::OnCooldown { used_at: t },
        _ => ContextState::Available,
    }
}

/// Healthstone, health potion, the running combat potion and personal defensives of the dead
/// player at the moment of death.
pub fn death_context(
    fight: &Fight,
    curated: &Curated,
    death: &Death,
    consumables: &[ConsumableUse],
    defensives: &[DefensiveUse],
) -> Vec<DeathContext> {
    let player = death.player;
    let mine = |kind: Option<ConsumableKind>| {
        consumables.iter().filter(move |u| {
            u.player == player && u.t <= death.t && kind.is_none_or(|k| u.kind == k)
        })
    };
    let mut context = Vec::new();

    let has_warlock = fight.actors.players().any(|actor| {
        actor
            .spec_id
            .and_then(openlogs_gamedata::spec)
            .is_some_and(|s| s.class_id == WARLOCK_CLASS_ID)
    });
    // Stones outlast the warlock who made them: anyone using one shows the raid had them.
    let stones_in_raid = consumables
        .iter()
        .any(|u| u.kind == ConsumableKind::Healthstone);
    let last_stone = mine(Some(ConsumableKind::Healthstone)).max_by_key(|u| u.t);
    if has_warlock || stones_in_raid {
        let cooldown = curated.consumables.healthstone_cooldown_s as i32 * 1_000;
        context.push(DeathContext {
            item: ContextItem::Healthstone,
            state: state(last_stone.map(|u| u.t), death.t, cooldown),
            spell: last_stone.map(|u| u.spell),
        });
    }

    // Each potion kind runs its own cooldown: in 12.x logs a health potion follows a combat
    // potion within 90 s, so combat and mana potions do not block it.
    let potion_cooldown = curated.consumables.potion_cooldown_s as i32 * 1_000;
    let last_health_potion = mine(Some(ConsumableKind::HealthPotion)).max_by_key(|u| u.t);
    context.push(DeathContext {
        item: ContextItem::HealthPotion,
        state: state(last_health_potion.map(|u| u.t), death.t, potion_cooldown),
        spell: last_health_potion.map(|u| u.spell),
    });
    // The combat potion of the current window: shown while its cooldown runs.
    if let Some(potion) = mine(Some(ConsumableKind::CombatPotion)).max_by_key(|u| u.t)
        && death.t - potion.t < potion_cooldown
    {
        context.push(DeathContext {
            item: ContextItem::CombatPotion,
            state: state(Some(potion.t), death.t, potion_cooldown),
            spell: Some(potion.spell),
        });
    }

    if let Some(spec_id) = spec_of(fight, player) {
        for defensive in curated.defensives_for(spec_id) {
            let uses: Vec<i32> = defensives
                .iter()
                .filter(|u| u.player == player && u.spell == defensive.spell_id)
                .map(|u| u.t)
                .collect();
            if !defensive.baseline && uses.is_empty() {
                continue;
            }
            let last = uses.into_iter().filter(|&t| t <= death.t).max();
            let cooldown = defensive.cooldown_s as i32 * 1_000;
            let at_death = match last {
                // Not once before the death, although it would have been ready again by now.
                None if death.t >= cooldown => ContextState::NeverUsed,
                last => state(last, death.t, cooldown),
            };
            context.push(DeathContext {
                item: ContextItem::Defensive(defensive.spell_id),
                state: at_death,
                spell: None,
            });
        }
    }
    context
}
