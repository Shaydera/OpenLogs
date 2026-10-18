use std::collections::BTreeMap;

use openlogs_analysis::{
    ActorId, EffectAnchorAt, EffectInstance, Fight, HealthTrack, PhaseKind, Replay, ReplayAura,
    ReplayCast, ReplayCastOutcome, ReplayDeath, ReplayUnit, SpellId, StackChange, Track, UnitKind,
};
use openlogs_gamedata::{ArenaFrame, EffectCategory, EffectKind};
use openlogs_index::MapBounds;
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
    pub power: Vec<PowerTrackDto>,
    pub targets: Vec<TargetTrackDto>,
    pub casts: Vec<ReplayCastDto>,
    pub auras: Vec<ReplayAuraDto>,
    pub raid_markers: Vec<RaidMarkerDto>,
    pub world_markers: Vec<WorldMarkerDto>,
    pub effects: Vec<EffectDto>,
    pub phases: Vec<PhaseDto>,
    pub deaths: Vec<ReplayDeathDto>,
    pub maps: Vec<MapBoundsDto>,
    pub arena_frame: Option<ArenaFrameDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerTrackDto {
    pub actor: ActorId,
    pub power_type: i32,
    pub t: Vec<i32>,
    pub current: Vec<i64>,
    pub max: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetTrackDto {
    pub actor: ActorId,
    pub t: Vec<i32>,
    pub target: Vec<ActorId>,
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
    pub map: Vec<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapBoundsDto {
    pub ui_map_id: u32,
    pub min_x: f32,
    pub max_x: f32,
    pub min_y: f32,
    pub max_y: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArenaFrameDto {
    pub ui_map_id: u32,
    pub x: f32,
    pub y: f32,
    pub size_yd: f32,
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
#[serde(rename_all = "snake_case")]
pub enum EffectKindDto {
    Beneficial,
    Harmful,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EffectCategoryDto {
    RaidCd,
    Heal,
    BossMechanic,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EffectAnchorDto {
    Ground { x: f32, y: f32 },
    Unit { actor: ActorId },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AffectedSpanDto {
    pub actor: ActorId,
    pub start_ms: i32,
    pub end_ms: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectDto {
    pub name: String,
    pub spell_id: SpellId,
    pub caster: ActorId,
    pub anchor: Option<EffectAnchorDto>,
    pub radius_yd: f32,
    pub start_ms: i32,
    pub end_ms: i32,
    pub estimated: bool,
    pub kind: EffectKindDto,
    pub category: EffectCategoryDto,
    pub tick_window_ms: u32,
    pub affected: Vec<AffectedSpanDto>,
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
    let effects = replay
        .effects
        .iter()
        .map(|effect| effect_dto(fight, &mut refs, effect))
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
        power: replay
            .power
            .iter()
            .map(|track| PowerTrackDto {
                actor: track.actor,
                power_type: track.power_type,
                t: track.t.clone(),
                current: track.current.clone(),
                max: track.max.clone(),
            })
            .collect(),
        targets: replay
            .targets
            .iter()
            .map(|track| TargetTrackDto {
                actor: track.actor,
                t: track.t.clone(),
                target: track.target.clone(),
            })
            .collect(),
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
        effects,
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
        maps: replay.maps.iter().map(map_bounds_dto).collect(),
        arena_frame: replay.arena_frame.as_ref().map(arena_frame_dto),
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
        map: track.map.clone(),
    }
}

fn map_bounds_dto(bounds: &MapBounds) -> MapBoundsDto {
    MapBoundsDto {
        ui_map_id: bounds.ui_map_id,
        min_x: centi(bounds.min_x),
        max_x: centi(bounds.max_x),
        min_y: centi(bounds.min_y),
        max_y: centi(bounds.max_y),
    }
}

fn arena_frame_dto(frame: &ArenaFrame) -> ArenaFrameDto {
    ArenaFrameDto {
        ui_map_id: frame.ui_map_id,
        x: centi(frame.x),
        y: centi(frame.y),
        size_yd: frame.size_yd,
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

fn effect_dto(fight: &Fight, refs: &mut Refs, effect: &EffectInstance) -> EffectDto {
    EffectDto {
        name: effect.name.clone(),
        spell_id: refs.spell(fight, effect.spell),
        caster: effect.caster,
        anchor: effect.anchor.map(|anchor| match anchor {
            EffectAnchorAt::Ground { x, y } => EffectAnchorDto::Ground {
                x: centi(x),
                y: centi(y),
            },
            EffectAnchorAt::Unit { actor } => EffectAnchorDto::Unit { actor },
        }),
        radius_yd: effect.radius_yd,
        start_ms: effect.start_ms,
        end_ms: effect.end_ms,
        estimated: effect.estimated,
        kind: match effect.kind {
            EffectKind::Beneficial => EffectKindDto::Beneficial,
            EffectKind::Harmful => EffectKindDto::Harmful,
        },
        category: match effect.category {
            EffectCategory::RaidCd => EffectCategoryDto::RaidCd,
            EffectCategory::Heal => EffectCategoryDto::Heal,
            EffectCategory::BossMechanic => EffectCategoryDto::BossMechanic,
        },
        tick_window_ms: effect.tick_window_ms,
        affected: effect
            .affected
            .iter()
            .map(|span| AffectedSpanDto {
                actor: span.actor,
                start_ms: span.start_ms,
                end_ms: span.end_ms,
            })
            .collect(),
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
    use openlogs_analysis::{
        Actors, AuraAction, AuraType, Event, EventKind, NO_SPELL, NOBODY, PositionSample,
        PowerSample, SpellInfo,
    };
    use openlogs_gamedata::{ArenaFrame, ChannelSpells, Curated};
    use openlogs_index::MapBounds;
    use serde_json::json;

    use super::*;
    use crate::test_fight::{PLAYER_FLAGS, fight, unit};

    #[test]
    fn replay_dto_rounds_coordinates_and_names_spells() {
        let mut actors = Actors::new();
        let mage = unit(&mut actors, "Player-1", "Faelan-Emberfall-EU", PLAYER_FLAGS);
        let paladin = unit(
            &mut actors,
            "Player-2",
            "Brannoc-Emberfall-EU",
            PLAYER_FLAGS,
        );
        let event = |t, source, target, spell, kind| Event {
            t,
            source,
            target,
            spell,
            kind,
            source_hostile: false,
            target_hostile: false,
            unit_hp: None,
        };
        let aura_mastery = EventKind::Aura {
            action: AuraAction::Applied,
            aura_type: AuraType::Buff,
            stacks: None,
            broken_by: NO_SPELL,
        };
        let mut fight = fight(
            actors,
            vec![
                event(1_000, mage, paladin, 44425, EventKind::CastSuccess),
                event(1_000, paladin, paladin, 31821, aura_mastery),
                event(1_500, mage, NOBODY, 97462, EventKind::CastSuccess),
            ],
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
            ui_map_id: 2608,
        });
        fight.positions.push(PositionSample {
            t: 1_000,
            actor: paladin,
            x: 0.0,
            y: 0.0,
            facing: 0.0,
            ui_map_id: 2609,
        });
        fight.power.push(PowerSample {
            t: 1_000,
            actor: mage,
            power_type: 0,
            current: 120,
            max: 200,
            primary: true,
        });
        fight.map_bounds = vec![MapBounds {
            ui_map_id: 2608,
            min_x: 265.004,
            max_x: 885.0,
            min_y: -802.5,
            max_y: 127.5,
        }];
        let mut curated = Curated::bundled();
        curated.arena_frames = vec![ArenaFrame {
            encounter_id: fight.encounter_id,
            ui_map_id: 2608,
            x: 512.5,
            y: -340.25,
            size_yd: 110.0,
        }];

        let replay = openlogs_analysis::replay(&fight, &curated, &ChannelSpells::default());
        let dto = replay_dto(&fight, &replay, true);
        let json = serde_json::to_value(&dto).unwrap();

        assert_eq!(json["advancedLogging"], true);
        assert_eq!(json["encounterId"], 3492);
        assert_eq!(json["roster"][0]["name"], "Faelan-Emberfall-EU");
        assert_eq!(json["spells"]["44425"]["name"], "Arcane Barrage");
        assert_eq!(json["casts"][0]["spellId"], 44425);
        assert_eq!(
            json["power"],
            json!([{ "actor": mage, "powerType": 0, "t": [1000], "current": [120], "max": [200] }])
        );
        assert_eq!(
            json["targets"],
            json!([{ "actor": mage, "t": [1000], "target": [paladin] }])
        );
        let tracks = serde_json::to_string(&dto.tracks).unwrap();
        assert!(
            tracks.contains(r#""x":[417.55]"#) && tracks.contains(r#""y":[-12.34]"#),
            "{tracks}"
        );
        assert_eq!(json["tracks"][0]["map"], json!([2608]));
        assert_eq!(json["tracks"][1]["map"], json!([2609]));
        assert_eq!(
            json["maps"],
            json!([{ "uiMapId": 2608, "minX": 265.0, "maxX": 885.0, "minY": -802.5, "maxY": 127.5 }])
        );
        assert_eq!(
            json["arenaFrame"],
            json!({ "uiMapId": 2608, "x": 512.5, "y": -340.25, "sizeYd": 110.0 })
        );
        assert_eq!(
            json["effects"][0]["anchor"],
            json!({ "type": "unit", "actor": paladin })
        );
        let rallying = &json["effects"][1];
        let effects = serde_json::to_string(&dto.effects).unwrap();
        assert!(
            effects.contains(r#""anchor":{"type":"ground","x":417.55,"y":-12.34}"#),
            "{effects}"
        );
        assert_eq!(rallying["spellId"], 97462);
        assert_eq!(rallying["category"], "raid_cd");
        assert_eq!(rallying["radiusYd"], 40.0);
        assert_eq!(rallying["tickWindowMs"], 3000);
    }
}
