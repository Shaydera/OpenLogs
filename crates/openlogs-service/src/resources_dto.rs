use std::collections::BTreeMap;

use openlogs_analysis::{Fight, ResourcesReport, SpellId, UnitRef, boss_units, unit_of};
use serde::Serialize;

use crate::overview_dto::{PlayerRef, SpellRef};
use crate::refs::Refs;
use crate::scope_dto::{UnitDto, unit_dto};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GainDto {
    pub spell_id: SpellId,
    pub gained: f64,
    pub wasted: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerTrackDto {
    pub power_type: i32,
    pub series: Vec<Option<f32>>,
    pub avg_pct: Option<f32>,
    pub min_pct: Option<f32>,
    pub capped_ms: u32,
    pub gained: f64,
    pub wasted: f64,
    pub gains: Vec<GainDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitResourcesDto {
    /// A player (in `roster`), or one enemy unit with its number among the units of its name.
    pub unit: UnitDto,
    /// One of the encounter's boss units.
    pub boss: bool,
    pub tracks: Vec<PowerTrackDto>,
    pub dead: Vec<[i32; 2]>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourcesReportDto {
    pub start_ms: i32,
    pub end_ms: i32,
    pub step_ms: u32,
    pub units: Vec<UnitResourcesDto>,
    pub roster: Vec<PlayerRef>,
    pub spells: BTreeMap<SpellId, SpellRef>,
}

pub fn resources_report_dto(fight: &Fight, report: &ResourcesReport) -> ResourcesReportDto {
    let mut refs = Refs::default();
    let bosses = boss_units(fight);
    let units = report
        .units
        .iter()
        .map(|p| UnitResourcesDto {
            unit: {
                let unit = unit_of(fight, p.unit);
                if let UnitRef::Player(id) = unit {
                    refs.player(id);
                }
                unit_dto(fight, &unit)
            },
            boss: bosses.contains(&p.unit),
            tracks: p
                .tracks
                .iter()
                .map(|t| PowerTrackDto {
                    power_type: t.power_type,
                    series: t.series.clone(),
                    avg_pct: t.avg_pct,
                    min_pct: t.min_pct,
                    capped_ms: t.capped_ms,
                    gained: t.gained,
                    wasted: t.wasted,
                    gains: t
                        .gains
                        .iter()
                        .map(|&(spell, gained, wasted)| GainDto {
                            spell_id: refs.spell(fight, spell),
                            gained,
                            wasted,
                        })
                        .collect(),
                })
                .collect(),
            dead: p.dead.iter().map(|&(a, b)| [a, b]).collect(),
        })
        .collect();
    let (roster, spells) = refs.finish(fight);
    ResourcesReportDto {
        start_ms: report.start_ms,
        end_ms: report.end_ms,
        step_ms: report.step_ms,
        units,
        roster,
        spells,
    }
}

#[cfg(test)]
mod tests {
    use openlogs_analysis::{
        Actors, Attribution, Event, NOBODY, ReportFilter, Scope, Side, UnitHp, resources_report,
    };

    use super::*;
    use crate::test_fight::{HOSTILE_FLAGS, PLAYER_FLAGS, damage_event, fight, unit};

    #[test]
    fn enemy_units_say_whether_they_are_a_boss() {
        let mut actors = Actors::new();
        let mage = unit(&mut actors, "Player-1", "Faelan-Emberfall-EU", PLAYER_FLAGS);
        let boss = unit(
            &mut actors,
            "Vehicle-0-1-1-1-257758-01",
            "Ula'tek",
            HOSTILE_FLAGS,
        );
        let add = unit(
            &mut actors,
            "Creature-0-1-1-1-261874-0001",
            "Blightscale Rawling",
            HOSTILE_FLAGS,
        );
        let hit = |t, target, amount, max| Event {
            unit_hp: Some(UnitHp {
                actor: target,
                current: max - amount,
                max,
            }),
            ..damage_event(t, mage, target, 1, amount, NOBODY)
        };
        let fight = fight(
            actors,
            vec![
                hit(1_000, boss, 1_000_000, 10_000_000),
                hit(2_000, add, 1_000, 100_000),
            ],
        );
        let enemies = Scope {
            perspective: Side::Enemy,
            ..Scope::default()
        };
        let report = resources_report(
            &fight,
            &ReportFilter::whole(Attribution::Augmented),
            &enemies,
        );
        let json = serde_json::to_value(resources_report_dto(&fight, &report)).unwrap();
        let flags: Vec<_> = json["units"]
            .as_array()
            .unwrap()
            .iter()
            .map(|u| (u["unit"]["name"].clone(), u["boss"].clone()))
            .collect();
        assert_eq!(
            flags,
            [
                (serde_json::json!("Ula'tek"), serde_json::json!(true)),
                (
                    serde_json::json!("Blightscale Rawling"),
                    serde_json::json!(false)
                ),
            ]
        );
    }
}
