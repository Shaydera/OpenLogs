use std::collections::BTreeMap;

use openlogs_analysis::{
    ActorId, Fight, HealthTrack, PhaseKind, Replay, ReplayAura, ReplayCast, ReplayCastOutcome,
    ReplayDeath, ReplayUnit, SpellId, StackChange, Track, UnitKind,
};
use serde::Serialize;

use crate::overview_dto::{PhaseDto, PhaseKindDto, PlayerRef, SpellRef};
use crate::refs::Refs;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayDto {
    pub encounter_id: u32,
    pub advanced_logging: bool,
    pub duration_ms: u64,
    pub roster: Vec<PlayerRef>,
    pub spells: BTreeMap<SpellId, SpellRef>,
    pub units: Vec<ReplayUnitDto>,
    pub tracks: Vec<TrackDto>,
    pub health: Vec<HealthTrackDto>,
    pub casts: Vec<ReplayCastDto>,
    pub auras: Vec<ReplayAuraDto>,
    pub raid_markers: Vec<RaidMarkerDto>,
    pub world_markers: Vec<WorldMarkerDto>,
    pub phases: Vec<PhaseDto>,
    pub deaths: Vec<ReplayDeathDto>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UnitKindDto {
    Player,
    Pet,
    Boss,
    Add,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayUnitDto {
    pub actor: ActorId,
    pub name: String,
    pub kind: UnitKindDto,
    pub spec_id: Option<u32>,
    pub class_id: Option<u32>,
    pub owner: Option<ActorId>,
    pub add_number: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackDto {
    pub actor: ActorId,
    pub t: Vec<i32>,
    pub x: Vec<f32>,
    pub y: Vec<f32>,
    pub facing: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthTrackDto {
    pub actor: ActorId,
    pub t: Vec<i32>,
    pub current: Vec<u64>,
    pub max: Vec<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplayCastOutcomeDto {
    Completed,
    Interrupted,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayCastDto {
    pub caster: ActorId,
    pub spell_id: SpellId,
    pub target: Option<ActorId>,
    pub start_ms: i32,
    pub end_ms: i32,
    pub outcome: ReplayCastOutcomeDto,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StackChangeDto {
    pub t: i32,
    pub stacks: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayAuraDto {
    pub target: ActorId,
    pub source: ActorId,
    pub spell_id: SpellId,
    pub buff: bool,
    pub start_ms: i32,
    pub end_ms: i32,
    pub stacks: Vec<StackChangeDto>,
    pub raid_frame: Option<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RaidMarkerDto {
    pub actor: ActorId,
    pub marker: u8,
    pub start_ms: i32,
    pub end_ms: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldMarkerDto {
    pub marker: u8,
    pub x: f32,
    pub y: f32,
    pub start_ms: i32,
    pub end_ms: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayDeathDto {
    pub actor: ActorId,
    pub t: i32,
    pub until: Option<i32>,
}

/// Rounds to 0.01: shorter numbers keep the bundle small.
fn centi(value: f32) -> f32 {
    (value * 100.0).round() / 100.0
}

pub fn replay_dto(fight: &Fight, replay: &Replay, advanced_logging: bool) -> ReplayDto {
    let mut refs = Refs::default();
    for unit in replay.units.iter().filter(|u| u.kind == UnitKind::Player) {
        refs.player(unit.actor);
    }
    let casts = replay
        .casts
        .iter()
        .map(|cast| cast_dto(fight, &mut refs, cast))
        .collect();
    let auras = replay
        .auras
        .iter()
        .map(|aura| aura_dto(fight, &mut refs, aura))
        .collect();
    let (roster, spells) = refs.finish(fight);
    ReplayDto {
        encounter_id: fight.encounter_id,
        advanced_logging,
        duration_ms: replay.duration_ms,
        roster,
        spells,
        units: replay.units.iter().map(unit_dto).collect(),
        tracks: replay.tracks.iter().map(track_dto).collect(),
        health: replay.health.iter().map(health_dto).collect(),
        casts,
        auras,
        raid_markers: replay
            .raid_markers
            .iter()
            .map(|m| RaidMarkerDto {
                actor: m.actor,
                marker: m.marker,
                start_ms: m.start_ms,
                end_ms: m.end_ms,
            })
            .collect(),
        world_markers: replay
            .world_markers
            .iter()
            .map(|m| WorldMarkerDto {
                marker: m.marker,
                x: centi(m.x),
                y: centi(m.y),
                start_ms: m.start_ms,
                end_ms: m.end_ms,
            })
            .collect(),
        phases: replay
            .phases
            .iter()
            .map(|p| PhaseDto {
                kind: match p.kind {
                    PhaseKind::Boss => PhaseKindDto::Boss,
                    PhaseKind::Intermission => PhaseKindDto::Intermission,
                    PhaseKind::Trash => PhaseKindDto::Trash,
                },
                number: p.number,
                start_ms: p.start_ms,
                end_ms: p.end_ms,
                name: p.name.clone(),
            })
            .collect(),
        deaths: replay.deaths.iter().map(death_dto).collect(),
    }
}

fn unit_dto(unit: &ReplayUnit) -> ReplayUnitDto {
    ReplayUnitDto {
        actor: unit.actor,
        name: unit.name.clone(),
        kind: match unit.kind {
            UnitKind::Player => UnitKindDto::Player,
            UnitKind::Pet => UnitKindDto::Pet,
            UnitKind::Boss => UnitKindDto::Boss,
            UnitKind::Add => UnitKindDto::Add,
        },
        spec_id: unit.spec_id,
        class_id: unit.class_id,
        owner: unit.owner,
        add_number: unit.add_number,
    }
}

fn track_dto(track: &Track) -> TrackDto {
    TrackDto {
        actor: track.actor,
        t: track.t.clone(),
        x: track.x.iter().copied().map(centi).collect(),
        y: track.y.iter().copied().map(centi).collect(),
        facing: track.facing.iter().copied().map(centi).collect(),
    }
}

fn health_dto(track: &HealthTrack) -> HealthTrackDto {
    HealthTrackDto {
        actor: track.actor,
        t: track.t.clone(),
        current: track.current.clone(),
        max: track.max.clone(),
    }
}

fn cast_dto(fight: &Fight, refs: &mut Refs, cast: &ReplayCast) -> ReplayCastDto {
    ReplayCastDto {
        caster: cast.caster,
        spell_id: refs.spell(fight, cast.spell),
        target: cast.target,
        start_ms: cast.start_ms,
        end_ms: cast.end_ms,
        outcome: match cast.outcome {
            ReplayCastOutcome::Completed => ReplayCastOutcomeDto::Completed,
            ReplayCastOutcome::Interrupted => ReplayCastOutcomeDto::Interrupted,
            ReplayCastOutcome::Failed => ReplayCastOutcomeDto::Failed,
        },
    }
}

fn aura_dto(fight: &Fight, refs: &mut Refs, aura: &ReplayAura) -> ReplayAuraDto {
    ReplayAuraDto {
        target: aura.target,
        source: aura.source,
        spell_id: refs.spell(fight, aura.spell),
        buff: aura.buff,
        start_ms: aura.start_ms,
        end_ms: aura.end_ms,
        stacks: aura
            .stacks
            .iter()
            .map(|StackChange { t, stacks }| StackChangeDto {
                t: *t,
                stacks: *stacks,
            })
            .collect(),
        raid_frame: aura.raid_frame,
    }
}

fn death_dto(death: &ReplayDeath) -> ReplayDeathDto {
    ReplayDeathDto {
        actor: death.actor,
        t: death.t,
        until: death.until,
    }
}

#[cfg(test)]
mod tests {
    use openlogs_analysis::{Actors, Event, EventKind, NOBODY, PositionSample, SpellInfo};
    use openlogs_gamedata::{ChannelSpells, Curated};

    use super::*;
    use crate::test_fight::{PLAYER_FLAGS, fight, unit};

    #[test]
    fn replay_dto_rounds_coordinates_and_names_spells() {
        let mut actors = Actors::new();
        let mage = unit(&mut actors, "Player-1", "Faelan-Emberfall-EU", PLAYER_FLAGS);
        let mut fight = fight(
            actors,
            vec![Event {
                t: 1_000,
                source: mage,
                target: NOBODY,
                spell: 44425,
                kind: EventKind::CastSuccess,
                source_hostile: false,
                target_hostile: false,
                unit_hp: None,
            }],
        );
        fight.spells.insert(
            44425,
            SpellInfo {
                name: "Arcane Barrage".into(),
                school: 64,
            },
        );
        fight.positions.push(PositionSample {
            t: 500,
            actor: mage,
            x: 417.5549,
            y: -12.3449,
            facing: 1.5,
        });

        let replay =
            openlogs_analysis::replay(&fight, &Curated::bundled(), &ChannelSpells::default());
        let dto = replay_dto(&fight, &replay, true);
        let json = serde_json::to_value(&dto).unwrap();

        assert_eq!(json["advancedLogging"], true);
        assert_eq!(json["encounterId"], 3492);
        assert_eq!(json["roster"][0]["name"], "Faelan-Emberfall-EU");
        assert_eq!(json["spells"]["44425"]["name"], "Arcane Barrage");
        assert_eq!(json["casts"][0]["spellId"], 44425);
        let tracks = serde_json::to_string(&dto.tracks).unwrap();
        assert!(
            tracks.contains(r#""x":[417.55]"#) && tracks.contains(r#""y":[-12.34]"#),
            "{tracks}"
        );
    }
}
