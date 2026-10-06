//! Owned, analysis-ready model of one fight: actors, spells and compact events.

mod actors;
mod deaths;
mod fight;
mod filter;
mod load;
mod phases;
mod reports;
mod timeline;

pub use actors::{Actor, ActorId, ActorKind, Actors, NOBODY};
pub use deaths::{Death, deaths};
pub use fight::{
    Absorbed, AuraAction, AuraType, Damage, DamageVia, Energize, Event, EventKind, Fight, Heal,
    MissType, Missed, NO_SPELL, SpellId, SpellInfo, UnitHp,
};
pub use filter::{Attribution, ReportFilter};
pub use load::{load_fight, load_fight_file};
pub use phases::configured_phases;
pub use reports::damage::{DamageReport, PlayerDamage, damage_done};
pub use reports::healing::{HealingReport, PlayerHealing, healing};
pub use reports::taken::{DamageTakenReport, TakenAbility, TakenPlayer, damage_taken};
pub use reports::{AbilityRow, RowKind};
pub use timeline::{
    ABORTED_PULL_MS, BOSS_HP_STEP_MS, DPS_STEP_MS, FightTimeline, MIN_INTERMISSION_MS, Phase,
    PhaseKind, boss_hp_series, boss_units, counts_as_damage_done, damage_done_amount,
    detect_phases, fight_timeline, hits_hostile_npc, is_aborted, name_detected_phases,
    raid_dps_series,
};
