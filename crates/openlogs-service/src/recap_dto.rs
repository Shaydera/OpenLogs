use std::collections::BTreeMap;

use openlogs_analysis::{ActorId, ActorKind, DeathRecap, Fight, NOBODY, RecapKind, SpellId};
use openlogs_gamedata::Curated;
use serde::Serialize;

use crate::overview_dto::{DeathDto, PlayerRef, SpellRef, death_dto, player_ref};
use crate::player_dto::{LethalBurstDto, ResurrectionDto, spec_name};
use crate::refs::name_of;

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

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeathsReportDto {
    pub deaths: Vec<DeathRecapDto>,
    pub roster: Vec<PlayerRef>,
    pub spells: BTreeMap<SpellId, SpellRef>,
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
    recaps: &[DeathRecap],
) -> DeathsReportDto {
    let mut spells = BTreeMap::new();
    let mut roster: Vec<ActorId> = Vec::new();
    let deaths = recaps
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
                    spell_id: note(fight, &mut spells, rez.spell),
                    source: caster.then_some(rez.source),
                }
            });
            let lethal_burst = recap.death.lethal_burst.map(|burst| LethalBurstDto {
                spell_id: note(fight, &mut spells, burst.spell),
                count: burst.count,
                window_ms: burst.window_ms,
            });
            DeathRecapDto {
                death: death_dto(fight, curated, &recap.death, &recap.context, &mut spells),
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
                        spell_id: note(fight, &mut spells, e.spell),
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
                        spell_id: note(fight, &mut spells, spell),
                        source_name: name_of(fight, source),
                    })
                    .collect(),
            }
        })
        .collect();
    DeathsReportDto {
        deaths,
        roster: roster.into_iter().map(|id| player_ref(fight, id)).collect(),
        spells,
    }
}

#[cfg(test)]
mod tests {
    use openlogs_analysis::{
        Actors, Death, DeathRecap, Hit, LethalBurst, RecapEvent, RecapKind, Resurrection, SpellInfo,
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
        let dto = deaths_report_dto(&fight, &Curated::bundled(), &[recap]);
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
