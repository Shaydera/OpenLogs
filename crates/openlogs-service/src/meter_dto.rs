use std::collections::BTreeMap;

use openlogs_analysis::{ActorId, Fight, Meter, MeterCategory, MeterKey, SpellId};
use serde::{Deserialize, Serialize};

use crate::overview_dto::SpellRef;
use crate::refs::name_of;
use crate::report_dto::{Names, RowKindDto};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MeterCategoryDto {
    DamageDone,
    HealingDone,
    DamageTaken,
    HealingReceived,
    Interrupts,
    Dispels,
}

impl MeterCategoryDto {
    pub fn to_category(self) -> MeterCategory {
        match self {
            Self::DamageDone => MeterCategory::DamageDone,
            Self::HealingDone => MeterCategory::HealingDone,
            Self::DamageTaken => MeterCategory::DamageTaken,
            Self::HealingReceived => MeterCategory::HealingReceived,
            Self::Interrupts => MeterCategory::Interrupts,
            Self::Dispels => MeterCategory::Dispels,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeterRowDto {
    pub player: ActorId,
    pub amount: i64,
    pub per_second: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum MeterEntryDto {
    Ability {
        spell_id: SpellId,
        actor_id: ActorId,
        row_kind: RowKindDto,
        amount: i64,
    },
    Spell {
        spell_id: SpellId,
        /// World damage, kept apart from melee (both spell 0).
        environmental: bool,
        amount: i64,
    },
    Unit {
        actor_id: ActorId,
        amount: i64,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeterDto {
    pub duration_ms: u64,
    pub rows: Vec<MeterRowDto>,
    pub breakdown: Vec<MeterEntryDto>,
    pub spells: BTreeMap<SpellId, SpellRef>,
    /// Names of the pets, healers and other units in `breakdown`.
    pub units: BTreeMap<ActorId, String>,
}

pub fn meter_dto(fight: &Fight, meter: &Meter) -> MeterDto {
    let mut names = Names::new(fight);
    let mut units = BTreeMap::new();
    let mut unit = |id: ActorId| {
        if let Some(name) = name_of(fight, id) {
            units.entry(id).or_insert(name);
        }
        id
    };
    let breakdown = meter
        .breakdown
        .iter()
        .map(|entry| match entry.key {
            MeterKey::Ability { spell, actor, kind } => MeterEntryDto::Ability {
                spell_id: names.spell(spell),
                actor_id: unit(actor),
                row_kind: kind.into(),
                amount: entry.amount,
            },
            MeterKey::Spell {
                spell,
                environmental,
            } => MeterEntryDto::Spell {
                spell_id: names.spell(spell),
                environmental,
                amount: entry.amount,
            },
            MeterKey::Unit(actor) => MeterEntryDto::Unit {
                actor_id: unit(actor),
                amount: entry.amount,
            },
        })
        .collect();
    let (_, spells) = names.finish();
    MeterDto {
        duration_ms: meter.duration_ms,
        rows: meter
            .rows
            .iter()
            .map(|row| MeterRowDto {
                player: row.player,
                amount: row.amount,
                per_second: row.per_second,
            })
            .collect(),
        breakdown,
        spells,
        units,
    }
}

#[cfg(test)]
mod tests {
    use openlogs_analysis::{Actors, Attribution, ReportFilter, meter};
    use serde_json::json;

    use super::*;
    use crate::test_fight::{HOSTILE_FLAGS, PET_FLAGS, PLAYER_FLAGS, damage_event, fight, unit};

    fn fall(t: i32, target: ActorId) -> openlogs_analysis::Event {
        let mut event = damage_event(
            t,
            openlogs_analysis::NOBODY,
            target,
            0,
            2_000,
            openlogs_analysis::NOBODY,
        );
        if let openlogs_analysis::EventKind::Damage(damage) = &mut event.kind {
            damage.via = openlogs_analysis::DamageVia::Environmental;
        }
        event.target_logged_hostile = false;
        event
    }

    #[test]
    fn meter_json_names_the_spells_and_units_of_its_breakdown() {
        let mut actors = Actors::new();
        let hunter = unit(
            &mut actors,
            "Player-1",
            "Brannoc-Emberfall-EU",
            PLAYER_FLAGS,
        );
        let evoker = unit(
            &mut actors,
            "Player-2",
            "Speronis-Stonevale-EU",
            PLAYER_FLAGS,
        );
        let wolf = unit(&mut actors, "Pet-0-1-1-1-1-0001", "Wolf", PET_FLAGS);
        actors.set_owner(wolf, hunter);
        let boss = unit(
            &mut actors,
            "Vehicle-0-1-1-1-257758-01",
            "Ula'tek",
            HOSTILE_FLAGS,
        );
        let mut fight = fight(
            actors,
            vec![
                damage_event(1_000, hunter, boss, 19434, 900, openlogs_analysis::NOBODY),
                damage_event(1_000, hunter, boss, 395152, 100, evoker),
                damage_event(2_000, wolf, boss, 17253, 300, openlogs_analysis::NOBODY),
                fall(3_000, hunter),
            ],
        );
        for (id, name) in [(19434, "Aimed Shot"), (17253, "Bite")] {
            fight.spells.insert(
                id,
                openlogs_analysis::SpellInfo {
                    name: name.into(),
                    school: 1,
                },
            );
        }
        let category: MeterCategoryDto = serde_json::from_value(json!("damageDone")).unwrap();
        let filter = ReportFilter::whole(Attribution::Reattributed);
        let report = meter(&fight, &filter, category.to_category(), Some(hunter));
        let json = serde_json::to_value(meter_dto(&fight, &report)).unwrap();
        assert_eq!(json["rows"][0]["player"], json!(hunter));
        assert_eq!(json["rows"][0]["perSecond"], json!(55.0));
        assert_eq!(
            json["breakdown"],
            json!([
                { "kind": "ability", "spellId": 19434, "actorId": hunter, "rowKind": "own", "amount": 800 },
                { "kind": "ability", "spellId": 17253, "actorId": wolf, "rowKind": "pet", "amount": 300 },
            ])
        );
        assert_eq!(
            json["spells"],
            json!({ "17253": { "name": "Bite" }, "19434": { "name": "Aimed Shot" } })
        );
        assert_eq!(
            json["units"],
            json!({ hunter.to_string(): "Brannoc-Emberfall-EU", wolf.to_string(): "Wolf" })
        );
        let taken = meter(&fight, &filter, MeterCategory::DamageTaken, Some(hunter));
        assert_eq!(
            serde_json::to_value(meter_dto(&fight, &taken)).unwrap()["breakdown"],
            json!([{ "kind": "spell", "spellId": 0, "environmental": true, "amount": 2_000 }])
        );
    }
}
