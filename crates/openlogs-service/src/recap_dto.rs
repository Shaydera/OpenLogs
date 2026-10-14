use std::collections::BTreeMap;

use openlogs_analysis::{
    ActorId, ActorKind, DeathRecap, DeathsReport, Fight, NOBODY, RecapKind, SpellId, UnitRef,
    unit_of,
};
use openlogs_gamedata::Curated;
use serde::Serialize;

use crate::overview_dto::{DeathDto, HitDto, PlayerRef, SpellRef, death_dto, hit_dto, player_ref};
use crate::player_dto::{LethalBurstDto, ResurrectionDto, spec_name};
use crate::refs::name_of;
use crate::scope_dto::{UnitDto, unit_dto};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecapKindDto {
    Damage,
    Heal,
    Absorb,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecapEventDto {
    pub t: i32,
    pub spell_id: SpellId,
    pub source_name: Option<String>,
    pub kind: RecapKindDto,
    pub amount: u64,
    pub absorbed: u64,
    pub excess: u64,
    pub hp_pct: Option<f32>,
    pub environmental: bool,
    /// A damage or heal over time tick: a source-less one reads "Debuff".
    pub periodic: bool,
    /// The player behind a pet, guardian or totem source ("Mulgar (Totem)").
    pub source_owner_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HpPointDto {
    pub t: i32,
    pub pct: f32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuffRefDto {
    pub spell_id: SpellId,
    pub source_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeathRecapDto {
    #[serde(flatten)]
    pub death: DeathDto,
    pub number: usize,
    /// "Arcane Mage"; `None` without COMBATANT_INFO.
    pub spec_name: Option<String>,
    /// The res spell and its caster (a player in `roster`).
    pub resurrected_by: Option<ResurrectionDto>,
    /// The killing blow's spell hitting in a row before the death.
    pub lethal_burst: Option<LethalBurstDto>,
    pub max_hp: Option<u64>,
    pub events: Vec<RecapEventDto>,
    pub hp: Vec<HpPointDto>,
    pub buffs: Vec<BuffRefDto>,
}

/// An enemy's death.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KillDto {
    pub t: i32,
    /// The unit with its number among the units of its name.
    pub unit: UnitDto,
    pub killing_blow: Option<HitDto>,
    /// Who landed the killing blow; a pet's is its owner's.
    pub killer: Option<UnitDto>,
    pub alive_ms: Option<i32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LethalDto {
    pub spell_id: SpellId,
    pub environmental: bool,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KillerDto {
    pub unit: UnitDto,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeathsReportDto {
    /// Friendlies: player deaths with their recap.
    pub deaths: Vec<DeathRecapDto>,
    /// Enemies: kills.
    pub kills: Vec<KillDto>,
    pub most_lethal: Option<LethalDto>,
    pub rezzed: u32,
    pub dead_units: u32,
    pub dead_ms: u64,
    pub top_killer: Option<KillerDto>,
    pub avg_alive_ms: Option<i32>,
    pub roster: Vec<PlayerRef>,
    pub spells: BTreeMap<SpellId, SpellRef>,
}

fn killer_dto(fight: &Fight, roster: &mut Vec<ActorId>, unit: &UnitRef) -> UnitDto {
    if let UnitRef::Player(id) = unit
        && !roster.contains(id)
    {
        roster.push(*id);
    }
    unit_dto(fight, unit)
}

fn note(fight: &Fight, spells: &mut BTreeMap<SpellId, SpellRef>, id: SpellId) -> SpellId {
    if let Some(info) = fight.spells.get(&id) {
        spells.entry(id).or_insert(SpellRef {
            name: info.name.clone(),
        });
    }
    id
}

pub fn deaths_report_dto(
    fight: &Fight,
    curated: &Curated,
    report: &DeathsReport,
) -> DeathsReportDto {
    let mut spells = BTreeMap::new();
    let mut roster: Vec<ActorId> = Vec::new();
    let deaths = recap_dtos(fight, curated, &report.recaps, &mut spells, &mut roster);
    let kills = report
        .kills
        .iter()
        .map(|kill| KillDto {
            t: kill.t,
            unit: unit_dto(fight, &unit_of(fight, kill.unit)),
            killing_blow: kill
                .killing_blow
                .map(|hit| hit_dto(fight, &mut spells, &hit)),
            killer: kill.killing_blow.map(|hit| {
                killer_dto(
                    fight,
                    &mut roster,
                    &unit_of(fight, hit.source).grouped(fight),
                )
            }),
            alive_ms: kill.alive_ms,
        })
        .collect();
    let most_lethal = report
        .most_lethal
        .map(|(spell, environmental, count)| LethalDto {
            spell_id: note(fight, &mut spells, spell),
            environmental,
            count,
        });
    let top_killer = report.top_killer.as_ref().map(|(unit, count)| KillerDto {
        unit: killer_dto(fight, &mut roster, unit),
        count: *count,
    });
    DeathsReportDto {
        deaths,
        kills,
        most_lethal,
        rezzed: report.rezzed,
        dead_units: report.dead_units,
        dead_ms: report.dead_ms,
        top_killer,
        avg_alive_ms: report.avg_alive_ms,
        roster: roster.into_iter().map(|id| player_ref(fight, id)).collect(),
        spells,
    }
}

fn recap_dtos(
    fight: &Fight,
    curated: &Curated,
    recaps: &[DeathRecap],
    spells: &mut BTreeMap<SpellId, SpellRef>,
    roster: &mut Vec<ActorId>,
) -> Vec<DeathRecapDto> {
    recaps
        .iter()
        .map(|recap| {
            if !roster.contains(&recap.death.player) {
                roster.push(recap.death.player);
            }
            let resurrected_by = recap.death.resurrected_by.map(|rez| {
                let caster =
                    rez.source != NOBODY && fight.actors.get(rez.source).kind == ActorKind::Player;
                if caster && !roster.contains(&rez.source) {
                    roster.push(rez.source);
                }
                ResurrectionDto {
                    spell_id: note(fight, spells, rez.spell),
                    source: caster.then_some(rez.source),
                }
            });
            let lethal_burst = recap.death.lethal_burst.map(|burst| LethalBurstDto {
                spell_id: note(fight, spells, burst.spell),
                count: burst.count,
                window_ms: burst.window_ms,
            });
            DeathRecapDto {
                death: death_dto(fight, curated, &recap.death, &recap.context, spells),
                number: recap.number,
                spec_name: spec_name(fight, recap.death.player),
                resurrected_by,
                lethal_burst,
                max_hp: recap.max_hp,
                events: recap
                    .events
                    .iter()
                    .map(|e| RecapEventDto {
                        t: e.t,
                        spell_id: note(fight, spells, e.spell),
                        source_name: name_of(fight, e.source),
                        kind: match e.kind {
                            RecapKind::Damage => RecapKindDto::Damage,
                            RecapKind::Heal => RecapKindDto::Heal,
                            RecapKind::Absorb => RecapKindDto::Absorb,
                        },
                        amount: e.amount,
                        absorbed: e.absorbed,
                        excess: e.excess,
                        hp_pct: e.hp_pct,
                        environmental: e.environmental,
                        periodic: e.periodic,
                        source_owner_name: name_of(fight, e.source_owner),
                    })
                    .collect(),
                hp: recap
                    .hp
                    .iter()
                    .map(|&(t, pct)| HpPointDto { t, pct })
                    .collect(),
                buffs: recap
                    .buffs
                    .iter()
                    .map(|&(spell, source)| BuffRefDto {
                        spell_id: note(fight, spells, spell),
                        source_name: name_of(fight, source),
                    })
                    .collect(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use openlogs_analysis::{
        Actors, Death, DeathRecap, DeathsReport, Hit, LethalBurst, RecapEvent, RecapKind,
        Resurrection, SpellInfo,
    };
    use openlogs_gamedata::Curated;

    use super::*;
    use crate::test_fight::{HOSTILE_FLAGS, PLAYER_FLAGS, fight, unit};

    #[test]
    fn recap_names_pet_owners_periodic_ticks_the_burst_and_the_rezzer() {
        let mut actors = Actors::new();
        let faelan = unit(&mut actors, "Player-1", "Faelan-Emberfall-EU", PLAYER_FLAGS);
        actors.set_spec(faelan, 62);
        let send = unit(
            &mut actors,
            "Player-2",
            "Serrik-Silverbrook-EU",
            PLAYER_FLAGS,
        );
        actors.set_spec(send, 105);
        let mulgar = unit(&mut actors, "Player-3", "Mulgar-Emberfall-EU", PLAYER_FLAGS);
        let totem = unit(
            &mut actors,
            "Creature-0-1-1-1-256196-01",
            "Stormstream Totem",
            0x2114,
        );
        actors.set_owner(totem, mulgar);
        let boss = unit(
            &mut actors,
            "Vehicle-0-1-1-1-257758-01",
            "Ula'tek",
            HOSTILE_FLAGS,
        );
        let mut fight = fight(actors, Vec::new());
        for (id, name) in [
            (1302982, "Virulent Spit"),
            (1267745, "Stormstream Totem"),
            (1297338, "Deadly Venom"),
            (20484, "Rebirth"),
        ] {
            fight.spells.insert(
                id,
                SpellInfo {
                    name: name.into(),
                    school: 1,
                },
            );
        }
        let event = |t, spell, source, kind, amount, periodic, source_owner| RecapEvent {
            t,
            spell,
            source,
            kind,
            amount,
            absorbed: 0,
            excess: 0,
            hp_pct: None,
            environmental: false,
            periodic,
            source_owner,
        };
        let recap = DeathRecap {
            death: Death {
                player: faelan,
                t: 239_107,
                killing_blow: Some(Hit {
                    t: 239_097,
                    spell: 1302982,
                    source: boss,
                    amount: 355_265,
                    overkill: 4_923,
                    environmental: false,
                    periodic: false,
                }),
                damage_last_5s: Vec::new(),
                damage_taken_5s: 0,
                healing_taken_5s: 0,
                hp_5s_before_pct: None,
                resurrected_at: Some(259_548),
                dead_until: Some(259_548),
                resurrected_by: Some(Resurrection {
                    spell: 20484,
                    source: send,
                }),
                lethal_burst: Some(LethalBurst {
                    spell: 1302982,
                    count: 2,
                    window_ms: 1_009,
                }),
            },
            number: 4,
            context: Vec::new(),
            max_hp: Some(959_133),
            events: vec![
                event(
                    236_470,
                    1297338,
                    NOBODY,
                    RecapKind::Damage,
                    45_999,
                    true,
                    NOBODY,
                ),
                event(
                    236_728,
                    1267745,
                    totem,
                    RecapKind::Heal,
                    14_195,
                    true,
                    mulgar,
                ),
            ],
            hp: Vec::new(),
            buffs: Vec::new(),
        };
        let report = DeathsReport {
            recaps: vec![recap],
            kills: Vec::new(),
            most_lethal: None,
            rezzed: 1,
            dead_units: 1,
            dead_ms: 20_441,
            top_killer: None,
            avg_alive_ms: None,
        };
        let dto = deaths_report_dto(&fight, &Curated::bundled(), &report);
        let json = serde_json::to_value(&dto).unwrap();
        let death = &json["deaths"][0];
        assert_eq!(death["killingBlow"]["periodic"], false);
        assert_eq!(death["events"][0]["periodic"], true);
        assert_eq!(death["events"][0]["sourceName"], serde_json::Value::Null);
        assert_eq!(
            death["events"][0]["sourceOwnerName"],
            serde_json::Value::Null
        );
        assert_eq!(death["events"][1]["sourceName"], "Stormstream Totem");
        assert_eq!(death["events"][1]["sourceOwnerName"], "Mulgar-Emberfall-EU");
        assert_eq!(
            death["lethalBurst"],
            serde_json::json!({ "spellId": 1302982, "count": 2, "windowMs": 1009 })
        );
        assert_eq!(
            death["resurrectedBy"],
            serde_json::json!({ "spellId": 20484, "source": send })
        );
        assert!(
            dto.roster.iter().any(|p| p.actor_id == send),
            "the rezzer is in the roster"
        );
        assert_eq!(dto.spells[&20484].name, "Rebirth");
    }
}
