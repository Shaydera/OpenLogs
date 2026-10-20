use std::collections::{BTreeMap, HashMap};

use openlogs_analysis::{
    AbilityRow, ActorId, Attribution, BuffShare, DamageReport, DamageTakenReport, Fight,
    GroupAbilities, HealingReport, NO_SPELL, Overkill, ReportFilter, RowKind, SpellId,
    TakenAbility, TargetKey, TargetShare,
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

/// Time range (ms since the pull started; `null` = open end), Aug mode and overkill rule from
/// the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterDto {
    pub start_ms: Option<i32>,
    pub end_ms: Option<i32>,
    pub attribution: AttributionDto,
    pub include_overkill: bool,
}

impl FilterDto {
    pub fn to_filter(self) -> ReportFilter {
        ReportFilter {
            start_ms: self.start_ms.unwrap_or(0),
            end_ms: self.end_ms.unwrap_or(i32::MAX),
            attribution: self.attribution.to_attribution(),
            overkill: Overkill::included_if(self.include_overkill),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RowKindDto {
    Own,
    Pet,
    SupportGiven,
    Unmatched,
}

impl From<RowKind> for RowKindDto {
    fn from(kind: RowKind) -> Self {
        match kind {
            RowKind::Own => Self::Own,
            RowKind::Pet => Self::Pet,
            RowKind::SupportGiven => Self::SupportGiven,
            RowKind::Unmatched => Self::Unmatched,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AbilityRowDto {
    pub spell_id: SpellId,
    pub actor_id: ActorId,
    /// Pet name for pet rows, the Evoker for support rows.
    pub actor_name: String,
    pub kind: RowKindDto,
    /// Reattributed mode: net of `support`.
    pub amount: i64,
    /// Reattributed mode: the part of the logged amount that moved to Evokers.
    pub support: u64,
    pub overheal: u64,
    pub hits: u32,
    pub crits: u32,
    pub max_hit: u64,
    pub ticks: u32,
}

/// Support of one Evoker's buff ("Ebon Might · Speronis").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuffShareDto {
    pub buff_id: SpellId,
    pub evoker: ActorId,
    pub amount: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetKindDto {
    Unit,
    Player,
    Unknown,
}

/// Whom an amount went to: an enemy (or friendly NPC) by name, a player (in the roster) or an unnamed unit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetRefDto {
    pub kind: TargetKindDto,
    /// The unit's name; empty for players and unknown units.
    pub name: String,
    pub player: Option<ActorId>,
    /// Units of this name that took damage in the range; 0 when not counted.
    pub units: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupAbilityDto {
    pub spell_id: SpellId,
    pub amount: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupAbilitiesDto {
    /// A colour group's enemy name; `None` for "Other".
    pub group: Option<String>,
    pub abilities: Vec<GroupAbilityDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetShareDto {
    pub target: TargetRefDto,
    pub amount: i64,
    pub hits: u32,
    pub crits: u32,
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
    pub support_received_by_buff: Vec<BuffShareDto>,
    pub support_credited_by_buff: Vec<BuffShareDto>,
    pub targets: Vec<TargetShareDto>,
    pub group_abilities: Vec<GroupAbilitiesDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DamageReportDto {
    pub duration_ms: u64,
    pub total: u64,
    pub players: Vec<PlayerDamageDto>,
    /// The raid's largest enemy groups in the range, largest first: the bars' colours.
    pub color_groups: Vec<String>,
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
    pub support_received_by_buff: Vec<BuffShareDto>,
    pub support_credited_by_buff: Vec<BuffShareDto>,
    pub targets: Vec<TargetShareDto>,
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
pub struct TakenAbilityDto {
    pub spell_id: SpellId,
    #[serde(skip)]
    pub spell_amounts: Vec<(SpellId, u64)>,
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
    units: HashMap<String, u32>,
}

impl<'a> Names<'a> {
    pub(crate) fn new(fight: &'a Fight) -> Self {
        Self {
            fight,
            roster: Vec::new(),
            spells: BTreeMap::new(),
            units: HashMap::new(),
        }
    }

    /// Unit counts by name for the targets' "58 units".
    pub(crate) fn with_units(mut self, units: &[(String, u32)]) -> Self {
        self.units = units.iter().cloned().collect();
        self
    }

    pub(crate) fn targets(&mut self, list: &[TargetShare]) -> Vec<TargetShareDto> {
        list.iter()
            .map(|share| TargetShareDto {
                target: match &share.target {
                    TargetKey::Unit(name) => TargetRefDto {
                        kind: TargetKindDto::Unit,
                        name: name.clone(),
                        player: None,
                        units: self.units.get(name).copied().unwrap_or(0),
                    },
                    TargetKey::Player(id) => TargetRefDto {
                        kind: TargetKindDto::Player,
                        name: String::new(),
                        player: Some(self.player(*id)),
                        units: 0,
                    },
                    TargetKey::Unknown => TargetRefDto {
                        kind: TargetKindDto::Unknown,
                        name: String::new(),
                        player: None,
                        units: 0,
                    },
                },
                amount: share.amount,
                hits: share.hits,
                crits: share.crits,
            })
            .collect()
    }

    fn group_abilities(&mut self, list: &[GroupAbilities]) -> Vec<GroupAbilitiesDto> {
        list.iter()
            .map(|group| GroupAbilitiesDto {
                group: group.group.clone(),
                abilities: group
                    .abilities
                    .iter()
                    .map(|&(spell, amount)| GroupAbilityDto {
                        spell_id: self.spell(spell),
                        amount,
                    })
                    .collect(),
            })
            .collect()
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
            kind: row.kind.into(),
            amount: row.amount,
            support: row.support,
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

    pub(crate) fn buff_shares(&mut self, list: &[BuffShare]) -> Vec<BuffShareDto> {
        list.iter()
            .map(|share| BuffShareDto {
                buff_id: self.spell(share.buff),
                evoker: self.player(share.evoker),
                amount: share.amount,
            })
            .collect()
    }

    pub(crate) fn taken(&mut self, a: &TakenAbility) -> TakenAbilityDto {
        TakenAbilityDto {
            spell_id: self.spell(a.spell),
            spell_amounts: a.spell_amounts.clone(),
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
    let mut names = Names::new(fight).with_units(&report.units);
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
            support_received_by_buff: names.buff_shares(&p.support_received_by_buff),
            support_credited_by_buff: names.buff_shares(&p.support_credited_by_buff),
            targets: names.targets(&p.targets),
            group_abilities: names.group_abilities(&p.group_abilities),
        })
        .collect();
    let (roster, spells) = names.finish();
    DamageReportDto {
        duration_ms: report.duration_ms,
        total: report.total,
        players,
        color_groups: report.color_groups.clone(),
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
            support_received_by_buff: names.buff_shares(&p.support_received_by_buff),
            support_credited_by_buff: names.buff_shares(&p.support_credited_by_buff),
            targets: names.targets(&p.targets),
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
    taken_dto(fight, report, false)
}

/// One pull's part of a set's report: every spell of a row is named, as the set may pick another.
pub fn taken_set_part_dto(fight: &Fight, report: &DamageTakenReport) -> DamageTakenReportDto {
    taken_dto(fight, report, true)
}

fn taken_dto(
    fight: &Fight,
    report: &DamageTakenReport,
    name_every_spell: bool,
) -> DamageTakenReportDto {
    let mut names = Names::new(fight);
    let by_ability: Vec<_> = report.by_ability.iter().map(|a| names.taken(a)).collect();
    let by_player: Vec<_> = report
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
    if name_every_spell {
        for row in by_ability
            .iter()
            .chain(by_player.iter().flat_map(|p| &p.abilities))
        {
            for &(spell, _) in &row.spell_amounts {
                names.spell(spell);
            }
        }
    }
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

#[cfg(test)]
mod tests {
    use openlogs_analysis::{Attribution, ReportFilter};

    use super::*;

    #[test]
    fn targets_carry_unit_counts_and_put_healed_players_in_the_roster() {
        use crate::test_fight::{
            HOSTILE_FLAGS, PLAYER_FLAGS, damage_event, fight, heal_event, unit,
        };
        use openlogs_analysis::{Actors, NOBODY, damage_done, healing};
        let mut actors = Actors::new();
        let mage = unit(&mut actors, "Player-1", "Faelan-Emberfall-EU", PLAYER_FLAGS);
        let tank = unit(&mut actors, "Player-2", "Aleth-Emberfall-EU", PLAYER_FLAGS);
        let adds = [
            unit(
                &mut actors,
                "Creature-0-1-1-1-2-01",
                "Blightscale Rawling",
                HOSTILE_FLAGS,
            ),
            unit(
                &mut actors,
                "Creature-0-1-1-1-2-02",
                "Blightscale Rawling",
                HOSTILE_FLAGS,
            ),
        ];
        let fight = fight(
            actors,
            vec![
                damage_event(1_000, mage, adds[0], 1, 300, NOBODY),
                damage_event(2_000, mage, adds[1], 1, 200, NOBODY),
                heal_event(3_000, mage, tank, 2, 400),
            ],
        );
        let filter = ReportFilter::whole(Attribution::Reattributed);
        let damage = damage_report_dto(&fight, &damage_done(&fight, &filter));
        let rawlings = &damage.players[0].targets[0];
        assert_eq!(
            (
                rawlings.target.kind,
                rawlings.target.name.as_str(),
                rawlings.target.units,
                rawlings.amount
            ),
            (TargetKindDto::Unit, "Blightscale Rawling", 2, 500)
        );
        assert_eq!(damage.color_groups, ["Blightscale Rawling"]);
        let heals = healing_report_dto(&fight, &healing(&fight, &filter));
        assert_eq!(heals.players[0].targets[0].target.player, Some(tank));
        assert!(heals.roster.iter().any(|p| p.actor_id == tank));
    }
}
