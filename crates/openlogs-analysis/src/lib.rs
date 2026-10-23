//! Owned, analysis-ready model of one fight: actors, spells and compact events.

mod ability;
mod actors;
mod aura_report;
mod auras;
mod breakdown;
mod casts;
mod cells;
mod compare;
mod deaths;
mod deaths_report;
mod fight;
mod filter;
mod interrupts;
mod links;
mod load;
mod meter;
mod options;
mod overview;
mod phases;
mod player;
mod recap;
mod replay;
mod reports;
mod resources;
mod run_result;
mod scope;
mod targets;
mod timeline;
mod usage;
mod views;

pub use ability::{AbilityDetail, AbilityHit, TargetHits, ability_detail};
pub use actors::{Actor, ActorId, ActorKind, Actors, NOBODY};
pub use aura_report::{AuraHolder, AuraLane, AuraRow, AurasReport, SourceSpec, auras_report};
pub use auras::{AuraInterval, aura_intervals, coverage, union_ms};
pub use breakdown::{
    Breakdown, BreakdownRow, Dimension, GroupedRow, RowKey, Split, breakdown, effective_group,
};
pub use casts::{CastExtra, CastsReport, casts_report};
pub use cells::{Cell, CellKind, ScopeMetric, cells};
pub use compare::{ComparedPlayer, PlayerSide, PullComparison, compare_pulls};
pub use deaths::{
    AbilityAmount, BURST_GAP_MS, DEATH_WINDOW_MS, Death, Hit, LethalBurst, Resurrection, deaths,
    nth_death_ms,
};
pub use deaths_report::{DeathsReport, Kill, deaths_report};
pub use fight::{
    Absorbed, AuraAction, AuraType, Damage, DamageVia, Energize, Event, EventKind, FailReason,
    Fight, FightKind, Heal, LANDED_MATCH_MS, MarkerInterval, MissType, Missed, NO_SPELL,
    POWER_SAMPLE_MS, PositionSample, PowerSample, RunEncounter, SpellId, SpellInfo, UnitHp,
    WorldMarkerInterval,
};
pub use filter::{Attribution, Overkill, ReportFilter};
pub use interrupts::{
    DispelEntry, InterruptEntry, InterruptsReport, KickRow, MissedCast, interrupts_report,
};
pub use links::AbilityLink;
pub use load::{
    LANDED_TAIL_BYTES, load_fight, load_fight_file, load_fight_slice, load_fight_slice_with,
};
pub use meter::{Meter, MeterCategory, MeterEntry, MeterKey, MeterRow, meter};
pub use options::{FilterOption, OptionValue, SpellVariant, filter_options};
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
pub use replay::{
    AffectedSpan, AuraCategory, EffectAnchorAt, EffectInstance, HealthTrack,
    PowerTrack as ReplayPowerTrack, Replay, ReplayAura, ReplayCast, ReplayCastOutcome, ReplayDeath,
    ReplayUnit, StackChange, TargetTrack, Track, UnitKind, replay,
};
pub use reports::damage::{DamageReport, PlayerDamage, damage_done, damage_done_set_part};
pub use reports::healing::{HealingReport, PlayerHealing, healing};
pub use reports::taken::{DamageTakenReport, TakenAbility, TakenPlayer, damage_taken};
pub use reports::{
    AbilityRow, AbilityTargets, BuffShare, BuffedAbility, COLOR_GROUPS, GroupAbilities, RowKind,
    SupportShare, TOP_ABILITIES_PER_GROUP, TargetKey, TargetShare, per_second,
};
pub use resources::{
    HEALTH, PowerTrack, RESOURCE_STEP_MS, ResourcesReport, UnitResources, resources_report,
};
pub use run_result::{BossProgress, RunResult, run_result};
pub use scope::{AbilityRef, Scope, Side, UnitRef, side_of, unit_of};
pub use targets::{
    EnemyGroup, TargetDetail, UnitLife, WAVE_GAP_MS, Wave, enemy_groups, target_detail,
};
pub use timeline::{
    ABORTED_PULL_MS, MIN_INTERMISSION_MS, Phase, PhaseKind, boss_hp_series, boss_units,
    damage_done_amount, detect_phases, hits_hostile_npc, is_aborted, is_distinct_hit,
    name_detected_phases, raid_dps_series,
};
pub use usage::{
    ConsumableUse, ContextItem, ContextState, CooldownUse, DeathContext, DefensiveUse,
    RECENT_USE_MS, REPEAT_WINDOW_MS, consumable_uses, cooldown_uses, death_context, defensive_uses,
};
pub use views::{
    AmountRule, CastOutcome, Channel, EventRow, EventsPage, ItemAmount, ItemKind, Lane, LogLine,
    Page, PowerLine, RowType, SharePart, Timeline, TimelineItem, ViewOptions, Window, events,
    timeline,
};
