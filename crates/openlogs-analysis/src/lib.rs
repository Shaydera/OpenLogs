//! Owned, analysis-ready model of one fight: actors, spells and compact events.

mod ability;
mod actors;
mod aura_report;
mod auras;
mod casts;
mod compare;
mod deaths;
mod fight;
mod filter;
mod interrupts;
mod links;
mod load;
mod overview;
mod phases;
mod player;
mod recap;
mod reports;
mod resources;
mod run_result;
mod targets;
mod timeline;
mod usage;

pub use ability::{AbilityDetail, AbilityHit, TargetHits, ability_detail};
pub use actors::{Actor, ActorId, ActorKind, Actors, NOBODY};
pub use aura_report::{AuraRow, AuraScope, AuraTarget, auras_report};
pub use auras::{AuraInterval, aura_intervals, union_ms};
pub use casts::{CastsReport, PlayerCasts, SpellCasts, casts_report};
pub use compare::{ComparedPlayer, PlayerSide, PullComparison, compare_pulls};
pub use deaths::{
    AbilityAmount, BURST_GAP_MS, DEATH_WINDOW_MS, Death, Hit, LethalBurst, Resurrection, deaths,
};
pub use fight::{
    Absorbed, AuraAction, AuraType, Damage, DamageVia, Energize, Event, EventKind, Fight,
    FightKind, Heal, MissType, Missed, NO_SPELL, POWER_SAMPLE_MS, PowerSample, RunEncounter,
    SpellId, SpellInfo, UnitHp,
};
pub use filter::{Attribution, ReportFilter};
pub use interrupts::{
    DispelEntry, InterruptEntry, InterruptsReport, MissedCast, interrupts_report,
};
pub use links::AbilityLink;
pub use load::{load_fight, load_fight_file};
pub use overview::{
    BOSS_HP_STEP_MS, DPS_STEP_MS, DeathReport, Kpis, OverviewMarkers, OverviewTimeline,
    QuickOverview, quick_overview, quick_overview_in,
};
pub use phases::{configured_phases, run_phases};
pub use player::{
    AugTarget, BuffKind, BuffRow, CAST_TIMELINE_ROWS, CastKind, CastRow, EBON_MIGHT, Metric,
    PRESCIENCE, PlayerAbility, PlayerDeath, PlayerDetail, SERIES_STEP_MS, SupportRecipient,
    player_detail,
};
pub use recap::{DeathRecap, RECAP_WINDOW_MS, RecapEvent, RecapKind, death_recaps};
pub use reports::damage::{DamageReport, PlayerDamage, damage_done};
pub use reports::healing::{HealingReport, PlayerHealing, healing};
pub use reports::taken::{DamageTakenReport, TakenAbility, TakenPlayer, damage_taken};
pub use reports::{
    AbilityRow, AbilityTargets, BuffShare, BuffedAbility, COLOR_GROUPS, GroupAbilities, RowKind,
    SupportShare, TOP_ABILITIES_PER_GROUP, TargetKey, TargetShare,
};
pub use resources::{
    PlayerResources, PowerTrack, RESOURCE_STEP_MS, ResourcesReport, resources_report,
};
pub use run_result::{BossProgress, RunResult, run_result};
pub use targets::{
    EnemyGroup, TargetDetail, UnitLife, WAVE_GAP_MS, Wave, enemy_groups, target_detail,
};
pub use timeline::{
    ABORTED_PULL_MS, MIN_INTERMISSION_MS, Phase, PhaseKind, boss_hp_series, boss_units,
    counts_as_damage_done, damage_done_amount, detect_phases, hits_hostile_npc, is_aborted,
    name_detected_phases, raid_dps_series,
};
pub use usage::{
    ConsumableUse, ContextItem, ContextState, CooldownUse, DeathContext, DefensiveUse,
    RECENT_USE_MS, REPEAT_WINDOW_MS, consumable_uses, cooldown_uses, death_context, defensive_uses,
};
