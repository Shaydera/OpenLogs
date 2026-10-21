use std::collections::{BTreeMap, BTreeSet};

use openlogs_analysis::{
    AbilityRef, ActorId, AuraHolder, AuraType, AurasReport, CellKind, Fight, ReportFilter, RowKey,
    SourceSpec, SpellId, UnitRef,
};
use serde::{Deserialize, Serialize};

use crate::overview_dto::{PlayerRef, SpellRef};
use crate::refs::Refs;
use crate::scope_dto::{DimensionDto, RowKeyDto, key_dto};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AuraKindDto {
    Buffs,
    Debuffs,
}

impl AuraKindDto {
    pub fn to_aura_type(self) -> AuraType {
        match self {
            AuraKindDto::Buffs => AuraType::Buff,
            AuraKindDto::Debuffs => AuraType::Debuff,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuraHolderDto {
    pub name: String,
    /// The player (in `roster`); `None` for an enemy group.
    pub player: Option<ActorId>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuraLaneDto {
    pub holder: AuraHolderDto,
    pub spell_id: SpellId,
    pub spell_ids: Vec<SpellId>,
    /// The players who applied it (in `roster`), most applications first: one source colours
    /// the uptime bar in its class colour.
    pub sources: Vec<ActorId>,
    #[serde(skip)]
    pub spell_counts: Vec<(SpellId, u32)>,
    #[serde(skip)]
    pub source_counts: Vec<(ActorId, u32)>,
    #[serde(skip)]
    pub source_specs: BTreeSet<SourceSpec>,
    pub applications: u32,
    pub uptime: f64,
    pub intervals: Vec<[i32; 2]>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuraRowDto {
    /// The aura (by aura) or the holder (by target), as a selection takes it.
    pub key: RowKeyDto,
    pub name: String,
    /// By aura: the aura's icon and every spell ID of its name, `spell_id` first; 0 and empty by target.
    pub spell_id: SpellId,
    pub spell_ids: Vec<SpellId>,
    pub holder: Option<AuraHolderDto>,
    pub sources: Vec<ActorId>,
    pub applications: u32,
    pub uptime: f64,
    pub lanes: Vec<AuraLaneDto>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EbonMightDto {
    pub uptime: f64,
    pub allies: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AurasReportDto {
    pub group: DimensionDto,
    pub start_ms: i32,
    pub end_ms: i32,
    pub rows: Vec<AuraRowDto>,
    pub ebon_might: Option<EbonMightDto>,
    pub players: u32,
    #[serde(skip)]
    pub player_ids: BTreeSet<ActorId>,
    pub roster: Vec<PlayerRef>,
    pub spells: BTreeMap<SpellId, SpellRef>,
}

fn holder_dto(refs: &mut Refs, holder: &AuraHolder) -> AuraHolderDto {
    AuraHolderDto {
        name: holder.name.clone(),
        player: holder.player.map(|p| refs.player(p)),
    }
}

pub fn auras_report_dto(
    fight: &Fight,
    filter: &ReportFilter,
    report: &AurasReport,
) -> AurasReportDto {
    let (start_ms, end_ms) = filter.clipped(fight);
    let mut refs = Refs::default();
    let rows = report
        .rows
        .iter()
        .map(|row| {
            let key = match &row.holder {
                Some(holder) => RowKey::Unit(match holder.player {
                    Some(player) => UnitRef::Player(player),
                    None => UnitRef::Unit(holder.name.clone()),
                }),
                None => RowKey::Ability {
                    ability: AbilityRef::of(fight, row.spell),
                    kind: CellKind::Own,
                    pet: None,
                },
            };
            let (key, name, _) = key_dto(fight, &key);
            AuraRowDto {
                key,
                name,
                spell_id: refs.spell(fight, row.spell),
                spell_ids: row.spells.iter().map(|&s| refs.spell(fight, s)).collect(),
                holder: row.holder.as_ref().map(|h| holder_dto(&mut refs, h)),
                sources: row.sources.iter().map(|&p| refs.player(p)).collect(),
                applications: row.applications,
                uptime: row.uptime,
                lanes: row
                    .lanes
                    .iter()
                    .map(|lane| AuraLaneDto {
                        holder: holder_dto(&mut refs, &lane.holder),
                        spell_id: refs.spell(fight, lane.spell),
                        spell_ids: lane.spells.iter().map(|&s| refs.spell(fight, s)).collect(),
                        sources: lane.sources.iter().map(|&p| refs.player(p)).collect(),
                        spell_counts: lane.spell_counts.clone(),
                        source_counts: lane.source_counts.clone(),
                        source_specs: lane.source_specs.clone(),
                        applications: lane.applications,
                        uptime: lane.uptime,
                        intervals: lane.intervals.iter().map(|&(a, b)| [a, b]).collect(),
                    })
                    .collect(),
            }
        })
        .collect();
    let (roster, spells) = refs.finish(fight);
    AurasReportDto {
        group: DimensionDto::of(report.group),
        start_ms,
        end_ms,
        rows,
        ebon_might: report
            .ebon_might
            .map(|(uptime, allies)| EbonMightDto { uptime, allies }),
        players: report.players,
        player_ids: report.player_ids.clone(),
        roster,
        spells,
    }
}

#[cfg(test)]
mod tests {
    use openlogs_analysis::{
        Actors, Attribution, AuraAction, Dimension, Event, EventKind, NO_SPELL, Scope, SpellInfo,
        auras_report,
    };

    use super::*;
    use crate::test_fight::{PLAYER_FLAGS, fight, unit};

    #[test]
    fn rows_carry_the_selection_they_stand_for() {
        let mut actors = Actors::new();
        let priest = unit(&mut actors, "Player-1", "Ulvara-Emberfall-EU", PLAYER_FLAGS);
        let mage = unit(&mut actors, "Player-2", "Faelan-Emberfall-EU", PLAYER_FLAGS);
        let applied = Event {
            t: 1_000,
            source: priest,
            target: mage,
            spell: 10060,
            kind: EventKind::Aura {
                action: AuraAction::Applied,
                aura_type: AuraType::Buff,
                stacks: None,
                broken_by: NO_SPELL,
            },
            source_hostile: false,
            target_hostile: false,
            unit_hp: None,
        };
        let mut fight = fight(actors, vec![applied]);
        fight.spells.insert(
            10060,
            SpellInfo {
                name: "Power Infusion".into(),
                school: 2,
            },
        );
        let filter = ReportFilter::whole(Attribution::Augmented);
        let json = |group| {
            let report = auras_report(&fight, &filter, &Scope::default(), AuraType::Buff, group);
            serde_json::to_value(auras_report_dto(&fight, &filter, &report)).unwrap()
        };
        assert_eq!(
            json(Dimension::Ability)["rows"][0]["key"],
            serde_json::json!({ "kind": "ability", "ability": { "kind": "name", "name": "Power Infusion" }, "rowKind": "own", "pet": null })
        );
        let by_target = json(Dimension::Target);
        assert_eq!(
            by_target["rows"][0]["key"],
            serde_json::json!({ "kind": "unit", "unit": { "kind": "player", "actorId": mage } })
        );
        assert_eq!(by_target["rows"][0]["lanes"][0]["spellId"], 10060);
    }
}
