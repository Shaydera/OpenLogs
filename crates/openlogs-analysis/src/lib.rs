//! Owned, analysis-ready model of one fight: actors, spells and compact events.

mod actors;
mod deaths;
mod fight;
mod filter;
mod load;
mod overview;
mod phases;
mod reports;
mod timeline;
mod usage;

pub use actors::{Actor, ActorId, ActorKind, Actors, NOBODY};
pub use deaths::{AbilityAmount, DEATH_WINDOW_MS, Death, Hit, deaths};
pub use fight::{
    Absorbed, AuraAction, AuraType, Damage, DamageVia, Energize, Event, EventKind, Fight, Heal,
    MissType, Missed, NO_SPELL, SpellId, SpellInfo, UnitHp,
};
pub use filter::{Attribution, ReportFilter};
pub use load::{load_fight, load_fight_file};
pub use overview::{
    BOSS_HP_STEP_MS, DPS_STEP_MS, DeathReport, Kpis, OverviewMarkers, OverviewTimeline,
    QuickOverview, quick_overview, quick_overview_in,
};
pub use phases::configured_phases;
pub use reports::damage::{DamageReport, PlayerDamage, damage_done};
pub use reports::healing::{HealingReport, PlayerHealing, healing};
pub use reports::taken::{DamageTakenReport, TakenAbility, TakenPlayer, damage_taken};
pub use reports::{AbilityRow, RowKind};
pub use timeline::{
    ABORTED_PULL_MS, MIN_INTERMISSION_MS, Phase, PhaseKind, boss_hp_series, boss_units,
    counts_as_damage_done, damage_done_amount, detect_phases, hits_hostile_npc, is_aborted,
    name_detected_phases, raid_dps_series,
};
pub use usage::{
    ConsumableUse, ContextItem, ContextState, CooldownUse, DeathContext, DefensiveUse,
    RECENT_USE_MS, REPEAT_WINDOW_MS, consumable_uses, cooldown_uses, death_context, defensive_uses,
};
