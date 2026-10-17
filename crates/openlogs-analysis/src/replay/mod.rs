mod auras;
mod casts;
mod effects;
mod health;
mod position;
mod tracks;
mod units;

use openlogs_gamedata::{ChannelSpells, Curated};

pub use auras::{ReplayAura, StackChange};
pub use casts::{ReplayCast, ReplayCastOutcome};
pub use effects::{AffectedSpan, EffectAnchorAt, EffectInstance};
pub use health::HealthTrack;
pub use tracks::Track;
pub use units::{ReplayUnit, UnitKind};

use crate::actors::ActorId;
use crate::auras::aura_intervals;
use crate::deaths::deaths;
use crate::fight::{EventKind, Fight, MarkerInterval, WorldMarkerInterval};
use crate::overview::BOSS_HP_STEP_MS;
use crate::phases::fight_phases;
use crate::timeline::{Phase, boss_hp_series, boss_units};
use units::Roster;

/// Everything the replay of one fight draws. Prelude data is cut at the start line: tracks keep
/// their last sample before it, everything else starts at 0.
#[derive(Debug, Clone, PartialEq)]
pub struct Replay {
    pub duration_ms: u64,
    pub units: Vec<ReplayUnit>,
    pub tracks: Vec<Track>,
    pub health: Vec<HealthTrack>,
    pub casts: Vec<ReplayCast>,
    pub auras: Vec<ReplayAura>,
    pub raid_markers: Vec<MarkerInterval>,
    pub world_markers: Vec<WorldMarkerInterval>,
    pub effects: Vec<EffectInstance>,
    pub phases: Vec<Phase>,
    pub deaths: Vec<ReplayDeath>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReplayDeath {
    pub actor: ActorId,
    pub t: i32,
    /// When the unit was alive again; `None`: dead to the end.
    pub until: Option<i32>,
}

pub fn replay(fight: &Fight, curated: &Curated, channels: &ChannelSpells) -> Replay {
    let bosses = boss_units(fight);
    let roster = Roster::new(fight, &bosses);
    let boss_hp = boss_hp_series(fight, &bosses, BOSS_HP_STEP_MS);
    let tracks = tracks::tracks(fight, &roster.units);
    let intervals = aura_intervals(fight);
    let (casts, channel_ends) = casts::casts(fight, curated, channels, &roster);
    Replay {
        duration_ms: fight.duration_ms,
        health: health::health(fight, &roster),
        casts,
        auras: auras::auras(fight, curated, &roster, &intervals),
        raid_markers: fight
            .raid_markers
            .iter()
            .filter_map(|marker| {
                let (start_ms, end_ms) = from_pull_start(marker.start_ms, marker.end_ms)?;
                Some(MarkerInterval {
                    start_ms,
                    end_ms,
                    ..*marker
                })
            })
            .collect(),
        world_markers: fight
            .world_markers
            .iter()
            .filter_map(|marker| {
                let (start_ms, end_ms) = from_pull_start(marker.start_ms, marker.end_ms)?;
                Some(WorldMarkerInterval {
                    start_ms,
                    end_ms,
                    ..*marker
                })
            })
            .collect(),
        effects: effects::effects(fight, curated, &tracks, &intervals, &channel_ends),
        tracks,
        phases: fight_phases(fight, curated, &boss_hp, BOSS_HP_STEP_MS),
        deaths: replay_deaths(fight, &roster),
        units: roster.units,
    }
}

/// `start..end` starting at 0 at the earliest; `None` when it ended before the pull.
fn from_pull_start(start: i32, end: i32) -> Option<(i32, i32)> {
    (end >= 0).then_some((start.max(0), end))
}

/// Player deaths end when the player is alive again; other units stay dead.
fn replay_deaths(fight: &Fight, roster: &Roster) -> Vec<ReplayDeath> {
    let players = deaths(fight).into_iter().map(|death| ReplayDeath {
        actor: death.player,
        t: death.t,
        until: death.dead_until,
    });
    let others = fight
        .events
        .iter()
        .filter(|event| {
            matches!(event.kind, EventKind::Died { unconscious: false })
                && roster
                    .kind(event.target)
                    .is_some_and(|kind| kind != UnitKind::Player)
        })
        .map(|event| ReplayDeath {
            actor: event.target,
            t: event.t.max(0),
            until: None,
        });
    let mut all: Vec<ReplayDeath> = players.chain(others).collect();
    all.sort_by_key(|death| death.t);
    all
}
