use openlogs_analysis::{
    AbilityRef, ActorId, ActorKind, Breakdown, BreakdownRow, CellKind, Dimension, Fight,
    FilterOption, OptionValue, RowKey, Scope, ScopeMetric, Side, SpellId, UnitRef,
};
use serde::{Deserialize, Serialize};

use crate::overview_dto::{PlayerRef, player_ref};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SideDto {
    #[default]
    Friendly,
    Enemy,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UnitRefDto {
    Player { actor_id: u32 },
    Pet { owner: u32, name: String },
    Unit { name: String },
    Instance { actor_id: u32 },
    Environment,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AbilityRefDto {
    Name { name: String },
    Id { spell_id: SpellId },
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ScopeDto {
    pub perspective: SideDto,
    pub source: Vec<UnitRefDto>,
    pub target: Vec<UnitRefDto>,
    pub ability: Vec<AbilityRefDto>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ScopeMetricDto {
    DamageDone,
    Healing,
    DamageTaken,
    Casts,
    Interrupts,
    Buffs,
    Debuffs,
    Deaths,
    Resources,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DimensionDto {
    Source,
    Ability,
    Target,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RowKindDto {
    Own,
    Support,
    Unmatched,
    Proc,
    Unattributed,
    State,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RowKeyDto {
    Unit {
        unit: UnitRefDto,
    },
    Ability {
        ability: AbilityRefDto,
        row_kind: RowKindDto,
    },
}

/// A unit with its display name and instance number, for report lists.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitDto {
    pub unit: UnitRefDto,
    /// Same rules as [`BreakdownRowDto::name`].
    pub name: String,
    pub number: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakdownRowDto {
    pub key: RowKeyDto,
    /// As logged (players without realm); empty for the environment, unnamed units and ability keys.
    pub name: String,
    /// The 1-based number of one instance among the units of its name.
    pub number: Option<u32>,
    pub spell_id: SpellId,
    pub amount: i64,
    pub share: f64,
    pub absorbed: i64,
    pub hits: u32,
    pub crits: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitDto {
    pub dimension: DimensionDto,
    pub rows: Vec<BreakdownRowDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupedRowDto {
    #[serde(flatten)]
    pub row: BreakdownRowDto,
    pub per_second: f64,
    pub splits: Vec<SplitDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakdownDto {
    pub group: DimensionDto,
    pub side: Vec<DimensionDto>,
    pub total: i64,
    pub duration_ms: u64,
    pub per_second: f64,
    pub rows: Vec<GroupedRowDto>,
    pub roster: Vec<PlayerRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum OptionValueDto {
    Unit { unit: UnitRefDto },
    Ability { ability: AbilityRefDto },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceDto {
    pub actor_id: u32,
    pub number: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariantDto {
    pub spell_id: SpellId,
    pub casts: u32,
    pub hits: u32,
    pub heals: u32,
    pub auras: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterOptionDto {
    pub value: OptionValueDto,
    /// Same rules as [`BreakdownRowDto::name`].
    pub name: String,
    pub number: Option<u32>,
    pub npc_id: Option<u32>,
    pub instances: Vec<InstanceDto>,
    pub pets: Vec<String>,
    pub primary_spell: Option<SpellId>,
    pub variants: Vec<VariantDto>,
}

impl ScopeDto {
    pub fn to_scope(&self) -> Scope {
        Scope {
            perspective: match self.perspective {
                SideDto::Friendly => Side::Friendly,
                SideDto::Enemy => Side::Enemy,
            },
            source: self.source.iter().map(UnitRefDto::to_unit).collect(),
            target: self.target.iter().map(UnitRefDto::to_unit).collect(),
            ability: self.ability.iter().map(AbilityRefDto::to_ability).collect(),
        }
    }
}

impl UnitRefDto {
    fn to_unit(&self) -> UnitRef {
        match self {
            Self::Player { actor_id } => UnitRef::Player(*actor_id),
            Self::Pet { owner, name } => UnitRef::Pet {
                owner: *owner,
                name: name.clone(),
            },
            Self::Unit { name } => UnitRef::Unit(name.clone()),
            Self::Instance { actor_id } => UnitRef::Instance(*actor_id),
            Self::Environment => UnitRef::Environment,
        }
    }

    pub(crate) fn of(unit: &UnitRef) -> Self {
        match unit {
            UnitRef::Player(id) => Self::Player { actor_id: *id },
            UnitRef::Pet { owner, name } => Self::Pet {
                owner: *owner,
                name: name.clone(),
            },
            UnitRef::Unit(name) => Self::Unit { name: name.clone() },
            UnitRef::Instance(id) => Self::Instance { actor_id: *id },
            UnitRef::Environment => Self::Environment,
        }
    }
}

impl AbilityRefDto {
    fn to_ability(&self) -> AbilityRef {
        match self {
            Self::Name { name } => AbilityRef::Name(name.clone()),
            Self::Id { spell_id } => AbilityRef::Id(*spell_id),
        }
    }

    pub(crate) fn of(ability: &AbilityRef) -> Self {
        match ability {
            AbilityRef::Name(name) => Self::Name { name: name.clone() },
            AbilityRef::Id(id) => Self::Id { spell_id: *id },
        }
    }
}

impl ScopeMetricDto {
    pub fn to_metric(self) -> ScopeMetric {
        match self {
            Self::DamageDone => ScopeMetric::DamageDone,
            Self::Healing => ScopeMetric::Healing,
            Self::DamageTaken => ScopeMetric::DamageTaken,
            Self::Casts => ScopeMetric::Casts,
            Self::Interrupts => ScopeMetric::Interrupts,
            Self::Buffs => ScopeMetric::Buffs,
            Self::Debuffs => ScopeMetric::Debuffs,
            Self::Deaths => ScopeMetric::Deaths,
            Self::Resources => ScopeMetric::Resources,
        }
    }
}

impl DimensionDto {
    pub fn to_dimension(self) -> Dimension {
        match self {
            Self::Source => Dimension::Source,
            Self::Ability => Dimension::Ability,
            Self::Target => Dimension::Target,
        }
    }

    pub(crate) fn of(dimension: Dimension) -> Self {
        match dimension {
            Dimension::Source => Self::Source,
            Dimension::Ability => Self::Ability,
            Dimension::Target => Self::Target,
        }
    }
}

fn short(name: &str) -> String {
    name.split('-').next().unwrap_or(name).to_string()
}

fn instance_number(fight: &Fight, id: ActorId) -> u32 {
    let name = &fight.actors.get(id).name;
    fight
        .actors
        .iter()
        .filter(|a| a.kind != ActorKind::Player && &a.name == name)
        .position(|a| a.id == id)
        .map_or(0, |p| p as u32 + 1)
}

fn unit_name(fight: &Fight, unit: &UnitRef) -> (String, Option<u32>) {
    match unit {
        UnitRef::Player(id) => (
            fight
                .actors
                .get(*id)
                .name
                .as_deref()
                .map(short)
                .unwrap_or_default(),
            None,
        ),
        UnitRef::Pet { name, .. } | UnitRef::Unit(name) => (name.clone(), None),
        UnitRef::Instance(id) => (
            fight.actors.get(*id).name.clone().unwrap_or_default(),
            Some(instance_number(fight, *id)),
        ),
        UnitRef::Environment => (String::new(), None),
    }
}

pub(crate) fn unit_dto(fight: &Fight, unit: &UnitRef) -> UnitDto {
    let (name, number) = unit_name(fight, unit);
    UnitDto {
        unit: UnitRefDto::of(unit),
        name,
        number,
    }
}

/// A row key with its display name and instance number.
pub(crate) fn key_dto(fight: &Fight, key: &RowKey) -> (RowKeyDto, String, Option<u32>) {
    match key {
        RowKey::Unit(unit) => {
            let (name, number) = unit_name(fight, unit);
            (
                RowKeyDto::Unit {
                    unit: UnitRefDto::of(unit),
                },
                name,
                number,
            )
        }
        RowKey::Ability { ability, kind } => {
            let row_kind = match kind {
                CellKind::Own => RowKindDto::Own,
                CellKind::Support => RowKindDto::Support,
                CellKind::Unmatched => RowKindDto::Unmatched,
                CellKind::Proc => RowKindDto::Proc,
                CellKind::Unattributed => RowKindDto::Unattributed,
                CellKind::State => RowKindDto::State,
            };
            (
                RowKeyDto::Ability {
                    ability: AbilityRefDto::of(ability),
                    row_kind,
                },
                ability_name(ability),
                None,
            )
        }
    }
}

fn ability_name(ability: &AbilityRef) -> String {
    match ability {
        AbilityRef::Name(name) => name.clone(),
        AbilityRef::Id(_) => String::new(),
    }
}

fn per_second(amount: i64, duration_ms: u64) -> f64 {
    if duration_ms == 0 {
        0.0
    } else {
        amount as f64 * 1000.0 / duration_ms as f64
    }
}

struct RowDtos<'a> {
    fight: &'a Fight,
    roster: Vec<ActorId>,
}

impl RowDtos<'_> {
    fn row(&mut self, row: &BreakdownRow, total: i64) -> BreakdownRowDto {
        if let RowKey::Unit(UnitRef::Player(id) | UnitRef::Pet { owner: id, .. }) = &row.key
            && !self.roster.contains(id)
        {
            self.roster.push(*id);
        }
        let (key, name, number) = key_dto(self.fight, &row.key);
        BreakdownRowDto {
            key,
            name,
            number,
            spell_id: row.spell,
            amount: row.amount,
            share: if total != 0 {
                row.amount as f64 / total as f64
            } else {
                0.0
            },
            absorbed: row.absorbed,
            hits: row.hits,
            crits: row.crits,
        }
    }
}

pub(crate) fn breakdown_dto(fight: &Fight, breakdown: &Breakdown) -> BreakdownDto {
    let mut dtos = RowDtos {
        fight,
        roster: Vec::new(),
    };
    let rows = breakdown
        .rows
        .iter()
        .map(|grouped| GroupedRowDto {
            row: dtos.row(&grouped.row, breakdown.total),
            per_second: per_second(grouped.row.amount, breakdown.duration_ms),
            splits: grouped
                .splits
                .iter()
                .map(|split| {
                    let sum: i64 = split.rows.iter().map(|r| r.amount).sum();
                    SplitDto {
                        dimension: DimensionDto::of(split.dimension),
                        rows: split.rows.iter().map(|r| dtos.row(r, sum)).collect(),
                    }
                })
                .collect(),
        })
        .collect();
    BreakdownDto {
        group: DimensionDto::of(breakdown.group),
        side: breakdown
            .side
            .iter()
            .copied()
            .map(DimensionDto::of)
            .collect(),
        total: breakdown.total,
        duration_ms: breakdown.duration_ms,
        per_second: per_second(breakdown.total, breakdown.duration_ms),
        rows,
        roster: dtos
            .roster
            .iter()
            .map(|&id| player_ref(fight, id))
            .collect(),
    }
}

pub(crate) fn option_dto(fight: &Fight, option: &FilterOption) -> FilterOptionDto {
    let (value, (name, number)) = match &option.value {
        OptionValue::Unit(unit) => (
            OptionValueDto::Unit {
                unit: UnitRefDto::of(unit),
            },
            unit_name(fight, unit),
        ),
        OptionValue::Ability(ability) => (
            OptionValueDto::Ability {
                ability: AbilityRefDto::of(ability),
            },
            (ability_name(ability), None),
        ),
    };
    FilterOptionDto {
        value,
        name,
        number,
        npc_id: option.npc_id,
        instances: option
            .instances
            .iter()
            .map(|&id| InstanceDto {
                actor_id: id,
                number: instance_number(fight, id),
            })
            .collect(),
        pets: option.pets.clone(),
        primary_spell: option.primary_spell,
        variants: option
            .variants
            .iter()
            .map(|v| VariantDto {
                spell_id: v.spell,
                casts: v.casts,
                hits: v.hits,
                heals: v.heals,
                auras: v.auras,
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report_dto::{AttributionDto, FilterDto};
    use crate::reports::breakdown_report;
    use crate::test_fight::{HOSTILE_FLAGS, PLAYER_FLAGS, damage_event, fight, unit};
    use openlogs_analysis::{Actors, NOBODY, SpellInfo};

    #[test]
    fn a_breakdown_round_trips_through_json_with_names_and_rates() {
        let mut actors = Actors::new();
        let warrior = unit(&mut actors, "Player-1", "Wendel-Emberfall-EU", PLAYER_FLAGS);
        let add = unit(
            &mut actors,
            "Creature-0-1-1-1-261874-0002",
            "Blightscale Rawling",
            HOSTILE_FLAGS,
        );
        let mut f = fight(
            actors,
            vec![damage_event(1_000, warrior, add, 1, 2_000, NOBODY)],
        );
        f.spells.insert(
            1,
            SpellInfo {
                name: "Mortal Strike".into(),
                school: 1,
            },
        );
        let filter = FilterDto {
            start_ms: None,
            end_ms: None,
            attribution: AttributionDto::Reattributed,
        };
        let scope: ScopeDto =
            serde_json::from_str(r#"{"source":[{"kind":"player","actorId":1}]}"#).unwrap();
        let dto = breakdown_report(
            &f,
            &openlogs_gamedata::Curated::bundled(),
            filter,
            scope,
            ScopeMetricDto::DamageDone,
            DimensionDto::Source,
        );
        let json = serde_json::to_value(&dto).unwrap();
        assert_eq!(json["group"], "ability");
        assert_eq!(json["rows"][0]["name"], "Mortal Strike");
        assert_eq!(json["rows"][0]["perSecond"], 100.0);
        assert_eq!(
            json["rows"][0]["splits"][0]["rows"][0]["name"],
            "Blightscale Rawling"
        );
    }
}
