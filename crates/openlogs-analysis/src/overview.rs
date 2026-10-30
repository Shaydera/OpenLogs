use std::collections::HashSet;

use openlogs_gamedata::{ConsumableKind, CooldownCategory, Curated};

use crate::actors::ActorId;
use crate::deaths::{Death, deaths};
use crate::fight::{EventKind, Fight, SpellId};
use crate::filter::{Attribution, Overkill, ReportFilter};
use crate::phases::fight_phases;
use crate::timeline::{
    Phase, boss_hp_series, boss_units, credited_as_damage_done, damage_done_amount, dealt_damage,
    hits_enemy, raid_dps_series,
};
use crate::usage::{
    ConsumableUse, CooldownUse, DeathContext, consumable_uses, cooldown_uses, death_context,
    defensive_uses,
};

pub const BOSS_HP_STEP_MS: u32 = 1_000;
pub const DPS_STEP_MS: u32 = 5_000;

#[derive(Debug, Clone, PartialEq)]
pub struct Kpis {
    /// Players with a spec from `COMBATANT_INFO`.
    pub players: u32,
    pub duration_ms: u64,
    pub raid_damage: u64,
    pub raid_dps: f64,
    pub deaths: u32,
    pub first_death_ms: Option<i32>,
    pub combat_potions: u32,
    pub players_without_combat_potion: u32,
    pub healthstones: u32,
    pub health_potions: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct OverviewTimeline {
    pub boss_hp_step_ms: u32,
    pub boss_hp: Vec<Option<f32>>,
    pub dps_step_ms: u32,
    pub raid_dps: Vec<f64>,
    pub phases: Vec<Phase>,
    /// Whole-pull markers, whatever the range.
    pub markers: OverviewMarkers,
}

/// Whole-pull markers for the brush graph.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct OverviewMarkers {
    pub deaths: Vec<(i32, ActorId)>,
    pub bloodlust: Vec<(i32, ActorId, SpellId)>,
    /// Cast starts of boss units.
    pub boss_casts: Vec<(i32, SpellId)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DeathReport {
    pub death: Death,
    pub context: Vec<DeathContext>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct QuickOverview {
    pub kpis: Kpis,
    pub timeline: OverviewTimeline,
    pub deaths: Vec<DeathReport>,
    pub consumables: Vec<ConsumableUse>,
    pub cooldowns: Vec<CooldownUse>,
}

pub fn quick_overview(fight: &Fight, curated: &Curated) -> QuickOverview {
    quick_overview_in(fight, curated, &ReportFilter::whole(Attribution::Augmented))
}

/// The overview for a time range. KPIs, deaths, consumables and cooldowns follow the range
/// (prelude uses count when it starts at 0); the timeline always covers the whole pull.
pub fn quick_overview_in(fight: &Fight, curated: &Curated, filter: &ReportFilter) -> QuickOverview {
    let (start, end) = filter.clipped(fight);
    let whole = start == 0 && i64::from(filter.end_ms) >= fight.duration_ms as i64;
    let keep = |t: i32| whole || (t < end && (t >= start || start == 0));
    let all_consumables: Vec<ConsumableUse> = consumable_uses(fight, curated);
    let defensives = defensive_uses(fight, curated);
    let all_deaths = deaths(fight);
    let all_cooldowns = cooldown_uses(fight, curated);
    // Spec-less players count too once they used a consumable or cooldown or died.
    let roster: HashSet<ActorId> = fight
        .actors
        .players()
        .filter(|p| p.spec_id.is_some())
        .map(|p| p.id)
        .chain(all_consumables.iter().map(|u| u.player))
        .chain(all_cooldowns.iter().map(|u| u.player))
        .chain(all_deaths.iter().map(|d| d.player))
        .collect();

    let bosses = boss_units(fight);
    let boss_set: HashSet<ActorId> = bosses.iter().copied().collect();
    let boss_hp = boss_hp_series(fight, &bosses, BOSS_HP_STEP_MS);
    let phases = fight_phases(fight, curated, &boss_hp, BOSS_HP_STEP_MS);
    let markers = OverviewMarkers {
        deaths: all_deaths.iter().map(|d| (d.t, d.player)).collect(),
        bloodlust: all_cooldowns
            .iter()
            .filter(|c| c.category == CooldownCategory::Bloodlust)
            .map(|c| (c.t, c.player, c.spell))
            .collect(),
        boss_casts: fight
            .events
            .iter()
            .filter(|e| {
                e.t >= 0 && matches!(e.kind, EventKind::CastStart) && boss_set.contains(&e.source)
            })
            .map(|e| (e.t, e.spell))
            .collect(),
    };
    let timeline = OverviewTimeline {
        boss_hp_step_ms: BOSS_HP_STEP_MS,
        boss_hp,
        dps_step_ms: DPS_STEP_MS,
        raid_dps: raid_dps_series(fight, DPS_STEP_MS, filter.overkill),
        phases,
        markers,
    };

    // Contexts look at every use: a potion before the range still counts for a death in it.
    let deaths: Vec<DeathReport> = all_deaths
        .into_iter()
        .filter(|d| keep(d.t))
        .map(|death| {
            let context = death_context(fight, curated, &death, &all_consumables, &defensives);
            DeathReport { death, context }
        })
        .collect();
    let consumables: Vec<ConsumableUse> =
        all_consumables.into_iter().filter(|u| keep(u.t)).collect();
    let cooldowns: Vec<CooldownUse> = all_cooldowns.into_iter().filter(|u| keep(u.t)).collect();

    let count = |kind: ConsumableKind| consumables.iter().filter(|u| u.kind == kind).count() as u32;
    let potion_users: HashSet<ActorId> = consumables
        .iter()
        .filter(|u| u.kind == ConsumableKind::CombatPotion)
        .map(|u| u.player)
        .collect();
    let raid_damage = raid_damage(fight, |t| whole || filter.contains(t), filter.overkill);
    let duration_ms = filter.duration_ms(fight);
    let seconds = duration_ms as f64 / 1000.0;
    let kpis = Kpis {
        players: roster.len() as u32,
        duration_ms,
        raid_damage,
        raid_dps: if seconds > 0.0 {
            raid_damage as f64 / seconds
        } else {
            0.0
        },
        deaths: deaths.len() as u32,
        first_death_ms: deaths.first().map(|d| d.death.t),
        combat_potions: count(ConsumableKind::CombatPotion),
        players_without_combat_potion: roster.len().saturating_sub(potion_users.len()) as u32,
        healthstones: count(ConsumableKind::Healthstone),
        health_potions: count(ConsumableKind::HealthPotion),
    };

    QuickOverview {
        kpis,
        timeline,
        deaths,
        consumables,
        cooldowns,
    }
}

fn raid_damage(fight: &Fight, in_range: impl Fn(i32) -> bool, overkill: Overkill) -> u64 {
    let end = fight.duration_ms as i64;
    fight
        .events
        .iter()
        .filter(|event| event.t >= 0 && i64::from(event.t) <= end && in_range(event.t))
        .filter_map(|event| {
            dealt_damage(event)
                .filter(credited_as_damage_done)
                .map(|damage| (event, damage))
        })
        .filter(|(event, _)| {
            hits_enemy(fight, event) && fight.actors.credited_player(event.source).is_some()
        })
        .map(|(_, damage)| damage_done_amount(&damage, overkill))
        .sum()
}
