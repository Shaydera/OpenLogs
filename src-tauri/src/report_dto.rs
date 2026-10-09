use std::collections::BTreeMap;

use openlogs_analysis::{
    AbilityRow, ActorId, Attribution, DamageReport, DamageTakenReport, Fight, HealingReport,
    NO_SPELL, ReportFilter, RowKind, SpellId, TakenAbility,
};
use serde::{Deserialize, Serialize};

use crate::overview_dto::{PlayerRef, SpellRef, player_ref};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AttributionDto {
    Augmented,
    Reattributed,
}

impl AttributionDto {
    pub fn to_attribution(self) -> Attribution {
        match self {
            Self::Augmented => Attribution::Augmented,
            Self::Reattributed => Attribution::Reattributed,
        }
    }
}

/// Time range (ms since the pull started; `null` = open end) and Aug mode from the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterDto {
    pub start_ms: Option<i32>,
    pub end_ms: Option<i32>,
    pub attribution: AttributionDto,
}

impl FilterDto {
    pub fn to_filter(self) -> ReportFilter {
        ReportFilter {
            start_ms: self.start_ms.unwrap_or(0),
            end_ms: self.end_ms.unwrap_or(i32::MAX),
            attribution: self.attribution.to_attribution(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RowKindDto {
    Own,
    Pet,
    SupportGiven,
    SupportDeducted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AbilityRowDto {
    pub spell_id: SpellId,
    pub actor_id: ActorId,
    /// Pet name for pet rows, the Evoker for support rows.
    pub actor_name: String,
    pub kind: RowKindDto,
    pub amount: i64,
    pub overheal: u64,
    pub hits: u32,
    pub crits: u32,
    pub max_hit: u64,
    pub ticks: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerAmount {
    pub player: ActorId,
    pub amount: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerDamageDto {
    pub player: ActorId,
    pub own: u64,
    pub support_received: u64,
    pub support_given: u64,
    /// The Evoker's share inside their own events; counted in both modes.
    pub support_self: u64,
    pub total: u64,
    pub per_second: f64,
    pub share: f64,
    pub abilities: Vec<AbilityRowDto>,
    pub support_by_recipient: Vec<PlayerAmount>,
    pub support_received_from: Vec<PlayerAmount>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DamageReportDto {
    pub duration_ms: u64,
    pub total: u64,
    pub players: Vec<PlayerDamageDto>,
    pub roster: Vec<PlayerRef>,
    pub spells: BTreeMap<SpellId, SpellRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerHealingDto {
    pub player: ActorId,
    pub healing: u64,
    pub absorbs: u64,
    pub overheal: u64,
    pub support_received: u64,
    pub support_given: u64,
    /// The Evoker's share inside their own events; counted in both modes.
    pub support_self: u64,
    pub total: u64,
    pub per_second: f64,
    pub share: f64,
    pub abilities: Vec<AbilityRowDto>,
    pub support_by_recipient: Vec<PlayerAmount>,
    pub support_received_from: Vec<PlayerAmount>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealingReportDto {
    pub duration_ms: u64,
    pub total: u64,
    pub overheal: u64,
    pub players: Vec<PlayerHealingDto>,
    pub roster: Vec<PlayerRef>,
    pub spells: BTreeMap<SpellId, SpellRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellAmount {
    pub spell_id: SpellId,
    pub amount: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TakenAbilityDto {
    pub spell_id: SpellId,
    /// World damage, kept apart from melee (both spell 0).
    pub environmental: bool,
    pub source_name: Option<String>,
    /// The source when it is a player (in the roster); `None` for NPCs, world and source-less damage.
    pub source_id: Option<ActorId>,
    pub amount: u64,
    pub absorbed: u64,
    pub hits: u32,
    pub players_hit: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TakenPlayerDto {
    pub player: ActorId,
    pub amount: u64,
    pub absorbed: u64,
    pub per_second: f64,
    pub share: f64,
    /// The player's damage taken by spell and source, largest first.
    pub abilities: Vec<TakenAbilityDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DamageTakenReportDto {
    pub duration_ms: u64,
    pub total: u64,
    pub by_ability: Vec<TakenAbilityDto>,
    pub by_player: Vec<TakenPlayerDto>,
    pub roster: Vec<PlayerRef>,
    pub spells: BTreeMap<SpellId, SpellRef>,
}

/// Collects the players and spells a report references, for names, colours and icons.
pub(crate) struct Names<'a> {
    fight: &'a Fight,
    roster: Vec<ActorId>,
    spells: BTreeMap<SpellId, SpellRef>,
}

impl<'a> Names<'a> {
    pub(crate) fn new(fight: &'a Fight) -> Self {
        Self {
            fight,
            roster: Vec::new(),
            spells: BTreeMap::new(),
        }
    }

    pub(crate) fn player(&mut self, id: ActorId) -> ActorId {
        if !self.roster.contains(&id) {
            self.roster.push(id);
        }
        id
    }

    pub(crate) fn spell(&mut self, id: SpellId) -> SpellId {
        if id != NO_SPELL {
            let name = self
                .fight
                .spells
                .get(&id)
                .map_or_else(String::new, |info| info.name.clone());
            self.spells.entry(id).or_insert(SpellRef { name });
        }
        id
    }

    pub(crate) fn row(&mut self, row: &AbilityRow) -> AbilityRowDto {
        let actor = self.fight.actors.get(row.actor);
        AbilityRowDto {
            spell_id: self.spell(row.spell),
            actor_id: row.actor,
            actor_name: actor.name.clone().unwrap_or_default(),
            kind: match row.kind {
                RowKind::Own => RowKindDto::Own,
                RowKind::Pet => RowKindDto::Pet,
                RowKind::SupportGiven => RowKindDto::SupportGiven,
                RowKind::SupportDeducted => RowKindDto::SupportDeducted,
            },
            amount: row.amount,
            overheal: row.overheal,
            hits: row.hits,
            crits: row.crits,
            max_hit: row.max,
            ticks: row.ticks,
        }
    }

    pub(crate) fn amounts(&mut self, list: &[(ActorId, u64)]) -> Vec<PlayerAmount> {
        list.iter()
            .map(|&(player, amount)| PlayerAmount {
                player: self.player(player),
                amount,
            })
            .collect()
    }

    pub(crate) fn taken(&mut self, a: &TakenAbility) -> TakenAbilityDto {
        TakenAbilityDto {
            spell_id: self.spell(a.spell),
            environmental: a.environmental,
            source_name: a.source_name.clone(),
            source_id: a.source_player.map(|id| self.player(id)),
            amount: a.amount,
            absorbed: a.absorbed,
            hits: a.hits,
            players_hit: a.players_hit,
        }
    }

    pub(crate) fn finish(self) -> (Vec<PlayerRef>, BTreeMap<SpellId, SpellRef>) {
        let roster = self
            .roster
            .iter()
            .map(|&id| player_ref(self.fight, id))
            .collect();
        (roster, self.spells)
    }
}

pub fn damage_report_dto(fight: &Fight, report: &DamageReport) -> DamageReportDto {
    let mut names = Names::new(fight);
    let players = report
        .players
        .iter()
        .map(|p| PlayerDamageDto {
            player: names.player(p.player),
            own: p.own,
            support_received: p.support_received,
            support_given: p.support_given,
            support_self: p.support_self,
            total: p.total,
            per_second: p.per_second,
            share: p.share,
            abilities: p.abilities.iter().map(|row| names.row(row)).collect(),
            support_by_recipient: names.amounts(&p.support_by_recipient),
            support_received_from: names.amounts(&p.support_received_from),
        })
        .collect();
    let (roster, spells) = names.finish();
    DamageReportDto {
        duration_ms: report.duration_ms,
        total: report.total,
        players,
        roster,
        spells,
    }
}

pub fn healing_report_dto(fight: &Fight, report: &HealingReport) -> HealingReportDto {
    let mut names = Names::new(fight);
    let players = report
        .players
        .iter()
        .map(|p| PlayerHealingDto {
            player: names.player(p.player),
            healing: p.healing,
            absorbs: p.absorbs,
            overheal: p.overheal,
            support_received: p.support_received,
            support_given: p.support_given,
            support_self: p.support_self,
            total: p.total,
            per_second: p.per_second,
            share: p.share,
            abilities: p.abilities.iter().map(|row| names.row(row)).collect(),
            support_by_recipient: names.amounts(&p.support_by_recipient),
            support_received_from: names.amounts(&p.support_received_from),
        })
        .collect();
    let (roster, spells) = names.finish();
    HealingReportDto {
        duration_ms: report.duration_ms,
        total: report.total,
        overheal: report.overheal,
        players,
        roster,
        spells,
    }
}

/// A spell in a player's damage-taken summary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TakenSpellDto {
    pub spell_id: SpellId,
    pub amount: u64,
    /// World damage, kept apart from melee (both spell 0).
    pub environmental: bool,
}

pub fn taken_report_dto(fight: &Fight, report: &DamageTakenReport) -> DamageTakenReportDto {
    let mut names = Names::new(fight);
    let by_ability = report.by_ability.iter().map(|a| names.taken(a)).collect();
    let by_player = report
        .by_player
        .iter()
        .map(|p| TakenPlayerDto {
            player: names.player(p.player),
            amount: p.amount,
            absorbed: p.absorbed,
            per_second: p.per_second,
            share: p.share,
            abilities: p.abilities.iter().map(|a| names.taken(a)).collect(),
        })
        .collect();
    let (roster, spells) = names.finish();
    DamageTakenReportDto {
        duration_ms: report.duration_ms,
        total: report.total,
        by_ability,
        by_player,
        roster,
        spells,
    }
}
