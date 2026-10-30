use std::collections::BTreeMap;

use openlogs_analysis::{ActorId, Fight, InterruptsReport, KickRow, SpellId, UnitRef, unit_of};
use serde::Serialize;

use crate::overview_dto::{PlayerRef, SpellRef};
use crate::refs::Refs;
use crate::scope_dto::{DimensionDto, RowKeyDto, UnitDto, UnitRefDto, key_dto, unit_dto};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KickRowDto {
    pub key: RowKeyDto,
    pub name: String,
    pub number: Option<u32>,
    pub spell_id: SpellId,
    #[serde(skip)]
    pub spell_counts: Vec<(SpellId, u32)>,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterruptDto {
    pub t: i32,
    pub source: UnitDto,
    pub spell_id: SpellId,
    pub target: UnitDto,
    pub interrupted_id: SpellId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispelDto {
    pub t: i32,
    pub source: UnitDto,
    pub spell_id: SpellId,
    pub target: UnitDto,
    pub removed_id: SpellId,
    pub stolen: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissedCastDto {
    pub t: i32,
    pub source: UnitDto,
    pub spell_id: SpellId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellCountDto {
    pub spell_id: SpellId,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterruptsReportDto {
    pub group: DimensionDto,
    pub interrupt_rows: Vec<KickRowDto>,
    pub dispel_rows: Vec<KickRowDto>,
    pub interrupts: Vec<InterruptDto>,
    pub dispels: Vec<DispelDto>,
    pub missed: Vec<MissedCastDto>,
    pub most_interrupted: Option<SpellCountDto>,
    pub kickers: u32,
    pub dispellers: u32,
    pub roster: Vec<PlayerRef>,
    pub spells: BTreeMap<SpellId, SpellRef>,
}

fn kick_rows(fight: &Fight, refs: &mut Refs, rows: &[KickRow]) -> Vec<KickRowDto> {
    rows.iter()
        .map(|row| {
            let (key, name, number) = key_dto(fight, &row.key);
            if let RowKeyDto::Unit {
                unit: UnitRefDto::Player { actor_id },
            } = key
            {
                refs.player(actor_id);
            }
            KickRowDto {
                key,
                name,
                number,
                spell_id: refs.spell(fight, row.spell),
                spell_counts: row.spell_counts.clone(),
                count: row.count,
            }
        })
        .collect()
}

/// A pet's action is its owner's on the rows, so sources fold into owners; a pet target keeps its own name; enemies go by name.
fn log_unit(fight: &Fight, refs: &mut Refs, actor: ActorId, fold_pets: bool) -> UnitDto {
    let unit = unit_of(fight, actor);
    let unit = match unit {
        UnitRef::Pet { .. } if !fold_pets => unit,
        _ => unit.grouped(fight),
    };
    if let UnitRef::Player(id) | UnitRef::Pet { owner: id, .. } = unit {
        refs.player(id);
    }
    unit_dto(fight, &unit)
}

pub fn interrupts_report_dto(fight: &Fight, report: &InterruptsReport) -> InterruptsReportDto {
    let mut refs = Refs::default();
    let interrupt_rows = kick_rows(fight, &mut refs, &report.interrupt_rows);
    let dispel_rows = kick_rows(fight, &mut refs, &report.dispel_rows);
    let interrupts = report
        .interrupts
        .iter()
        .map(|i| InterruptDto {
            t: i.t,
            source: log_unit(fight, &mut refs, i.source, true),
            spell_id: refs.spell(fight, i.spell),
            target: log_unit(fight, &mut refs, i.target, false),
            interrupted_id: refs.spell(fight, i.interrupted),
        })
        .collect();
    let dispels = report
        .dispels
        .iter()
        .map(|d| DispelDto {
            t: d.t,
            source: log_unit(fight, &mut refs, d.source, true),
            spell_id: refs.spell(fight, d.spell),
            target: log_unit(fight, &mut refs, d.target, false),
            removed_id: refs.spell(fight, d.removed),
            stolen: d.stolen,
        })
        .collect();
    let missed = report
        .missed
        .iter()
        .map(|m| MissedCastDto {
            t: m.t,
            source: log_unit(fight, &mut refs, m.source, true),
            spell_id: refs.spell(fight, m.spell),
        })
        .collect();
    let most_interrupted = report.most_interrupted.map(|(spell, count)| SpellCountDto {
        spell_id: refs.spell(fight, spell),
        count,
    });
    let (roster, spells) = refs.finish(fight);
    InterruptsReportDto {
        group: DimensionDto::of(report.group),
        interrupt_rows,
        dispel_rows,
        interrupts,
        dispels,
        missed,
        most_interrupted,
        kickers: report.kickers,
        dispellers: report.dispellers,
        roster,
        spells,
    }
}

#[cfg(test)]
mod tests {
    use openlogs_analysis::{Actors, Attribution, Dimension, EventKind, ReportFilter, Scope};

    use super::*;
    use crate::test_fight::{HOSTILE_FLAGS, PLAYER_FLAGS, fight, unit};

    #[test]
    fn log_units_name_players_and_enemies_and_join_the_roster() {
        let mut actors = Actors::new();
        let paladin = unit(&mut actors, "Player-1", "Puran-Ironmoor-EU", PLAYER_FLAGS);
        let aleth = unit(&mut actors, "Player-2", "Aleth-Emberfall-EU", PLAYER_FLAGS);
        let boss = unit(
            &mut actors,
            "Vehicle-0-1-1-1-257758-01",
            "Ula'tek",
            HOSTILE_FLAGS,
        );
        let dispel = |target, target_logged_hostile| openlogs_analysis::Event {
            t: 33_973,
            source: paladin,
            target,
            spell: 4987,
            kind: EventKind::Dispel {
                removed: 1287036,
                aura_type: openlogs_analysis::AuraType::Debuff,
            },
            source_logged_hostile: false,
            target_logged_hostile,
            unit_hp: None,
        };
        let fight = fight(actors, vec![dispel(aleth, false), dispel(boss, true)]);
        let report = openlogs_analysis::interrupts_report(
            &fight,
            &ReportFilter::whole(Attribution::Augmented),
            &Scope::default(),
            Dimension::Source,
        );
        let json = serde_json::to_value(interrupts_report_dto(&fight, &report)).unwrap();
        assert_eq!(
            json["dispels"][0]["target"],
            serde_json::json!({ "unit": { "kind": "player", "actorId": aleth }, "name": "Aleth", "number": null })
        );
        assert_eq!(
            json["dispels"][1]["target"],
            serde_json::json!({ "unit": { "kind": "unit", "name": "Ula'tek" }, "name": "Ula'tek", "number": null })
        );
        assert_eq!(json["dispelRows"][0]["count"], 2);
        let roster: Vec<_> = json["roster"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["actorId"].clone())
            .collect();
        assert_eq!(
            roster,
            [serde_json::json!(paladin), serde_json::json!(aleth)]
        );
    }

    #[test]
    fn a_pet_target_keeps_its_own_name() {
        let mut actors = Actors::new();
        let hunter = unit(&mut actors, "Player-1", "Hunt-Ironmoor-EU", PLAYER_FLAGS);
        let wolf = unit(&mut actors, "Pet-0-1-1-1-1-0001", "Wolf", 0x2114);
        actors.set_owner(wolf, hunter);
        let dispel = openlogs_analysis::Event {
            t: 1_000,
            source: hunter,
            target: wolf,
            spell: 4987,
            kind: EventKind::Dispel {
                removed: 1,
                aura_type: openlogs_analysis::AuraType::Debuff,
            },
            source_logged_hostile: false,
            target_logged_hostile: false,
            unit_hp: None,
        };
        let fight = fight(actors, vec![dispel]);
        let report = openlogs_analysis::interrupts_report(
            &fight,
            &ReportFilter::whole(Attribution::Augmented),
            &Scope::default(),
            Dimension::Source,
        );
        let json = serde_json::to_value(interrupts_report_dto(&fight, &report)).unwrap();
        assert_eq!(json["dispels"][0]["target"]["name"], "Wolf");
        assert_eq!(json["dispels"][0]["source"]["name"], "Hunt");
    }
}
