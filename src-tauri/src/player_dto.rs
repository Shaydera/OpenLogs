use std::collections::BTreeMap;

use openlogs_analysis::{
    AbilityLink, ActorId, ActorKind, BuffKind, CastKind, EBON_MIGHT, Fight, Metric, NOBODY,
    PlayerDetail, SpellId,
};
use openlogs_gamedata::{ConsumableKind, Curated};
use serde::{Deserialize, Serialize};

use crate::overview_dto::{
    ContextDto, HitDto, PlayerRef, SpellRef, context_dtos, player_ref, without_shields,
};
use crate::report_dto::{
    AbilityRowDto, AttributionDto, BuffShareDto, Names, PlayerAmount, TakenSpellDto, TargetShareDto,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MetricDto {
    Damage,
    Healing,
}

impl From<Metric> for MetricDto {
    fn from(metric: Metric) -> Self {
        match metric {
            Metric::Damage => MetricDto::Damage,
            Metric::Healing => MetricDto::Healing,
        }
    }
}

/// The ability page that holds a cast spell's hits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AbilityLinkDto {
    pub spell_id: SpellId,
    pub metric: MetricDto,
}

impl From<AbilityLink> for AbilityLinkDto {
    fn from(link: AbilityLink) -> Self {
        AbilityLinkDto {
            spell_id: link.spell,
            metric: link.metric.into(),
        }
    }
}

impl MetricDto {
    pub fn to_metric(self) -> Metric {
        match self {
            MetricDto::Damage => Metric::Damage,
            MetricDto::Healing => Metric::Healing,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerAbilityDto {
    #[serde(flatten)]
    pub row: AbilityRowDto,
    pub casts: Option<u32>,
    pub aug: bool,
    /// Pet names merged into the pet row; 0 for other rows.
    pub pets: u32,
    /// Reattributed mode: the row's `support` by buff and Evoker.
    pub support_from: Vec<BuffShareDto>,
    /// Reattributed mode, the Evoker's support rows: the supported players and abilities.
    pub recipients: Vec<SupportRecipientDto>,
    /// The row by target, largest first.
    pub targets: Vec<TargetShareDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportRecipientDto {
    pub player: ActorId,
    pub amount: u64,
    pub abilities: Vec<SupportedAbilityDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportedAbilityDto {
    /// `None` for hits no ability could be matched to.
    pub spell_id: Option<SpellId>,
    /// The pet's name when a pet cast it, else `None`.
    pub pet_name: Option<String>,
    pub amount: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResurrectionDto {
    pub spell_id: SpellId,
    /// The caster when it is a player (named in `roster`); `None` otherwise.
    pub source: Option<ActorId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LethalBurstDto {
    pub spell_id: SpellId,
    pub count: u32,
    pub window_ms: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerDeathDto {
    pub t: i32,
    pub resurrected_at: Option<i32>,
    pub killing_blow: Option<HitDto>,
    pub resurrected_by: Option<ResurrectionDto>,
    pub lethal_burst: Option<LethalBurstDto>,
    pub context: Vec<ContextDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerConsumableDto {
    pub t: i32,
    pub spell_id: SpellId,
    pub kind: ConsumableKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CastKindDto {
    Major,
    Rotation,
    Defensive,
}

impl From<CastKind> for CastKindDto {
    fn from(kind: CastKind) -> Self {
        match kind {
            CastKind::Major => CastKindDto::Major,
            CastKind::Rotation => CastKindDto::Rotation,
            CastKind::Defensive => CastKindDto::Defensive,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CastRowDto {
    pub spell_id: SpellId,
    /// Major cooldown, rotation (the catalogue's or, without one, the most-cast spells) or
    /// defensive.
    pub kind: CastKindDto,
    pub duration_ms: u32,
    pub times: Vec<i32>,
    pub link: Option<AbilityLinkDto>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BuffKindDto {
    Aug,
    Lust,
    External,
    Cooldown,
    Proc,
    Shield,
    Defensive,
}

impl From<BuffKind> for BuffKindDto {
    fn from(kind: BuffKind) -> Self {
        match kind {
            BuffKind::Aug => BuffKindDto::Aug,
            BuffKind::Lust => BuffKindDto::Lust,
            BuffKind::External => BuffKindDto::External,
            BuffKind::Cooldown => BuffKindDto::Cooldown,
            BuffKind::Proc => BuffKindDto::Proc,
            BuffKind::Shield => BuffKindDto::Shield,
            BuffKind::Defensive => BuffKindDto::Defensive,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuffRowDto {
    pub spell_id: SpellId,
    pub source: ActorId,
    pub kind: BuffKindDto,
    pub intervals: Vec<[i32; 2]>,
    pub uptime: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AugTargetDto {
    pub player: ActorId,
    pub support: u64,
    pub ebon_might_uptime: f64,
    pub prescience_uptime: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerDetailDto {
    pub player: PlayerRef,
    /// E.g. "Arcane Mage".
    pub spec_name: Option<String>,
    pub item_level: Option<u32>,
    pub max_hp: Option<u64>,
    pub metric: MetricDto,
    /// The Aug mode this page was computed with; the UI names the other mode from it.
    pub attribution: AttributionDto,
    pub start_ms: i32,
    pub end_ms: i32,
    pub total: u64,
    pub other_mode_total: u64,
    pub per_second: f64,
    pub rank: usize,
    pub ranked_players: usize,
    pub support_received: u64,
    pub support_received_from: Vec<PlayerAmount>,
    pub healing_received: u64,
    pub deaths: Vec<PlayerDeathDto>,
    pub consumables: Vec<PlayerConsumableDto>,
    pub abilities: Vec<PlayerAbilityDto>,
    /// The pet row's parts: every pet ability by pet name, largest first.
    pub pet_abilities: Vec<PlayerAbilityDto>,
    pub taken_by_spell: Vec<TakenSpellDto>,
    pub series_step_ms: u32,
    pub series: Vec<f64>,
    pub cast_rows: Vec<CastRowDto>,
    /// The player's own casts, most frequent spells first.
    pub cast_timeline: Vec<CastRowDto>,
    pub buff_rows: Vec<BuffRowDto>,
    pub ebon_might: Vec<[i32; 2]>,
    pub dead: Vec<[i32; 2]>,
    pub dead_since: Option<i32>,
    pub augmentation: Vec<AugTargetDto>,
    pub targets: Vec<TargetShareDto>,
    /// The raid's largest enemy groups in the range (damage only): the bars' colours.
    pub color_groups: Vec<String>,
    pub mana: Vec<Option<f32>>,
    /// Players with a spec (for the switcher) plus every player the page references, by name.
    pub roster: Vec<PlayerRef>,
    pub spells: BTreeMap<SpellId, SpellRef>,
}

pub(crate) fn spec_name(fight: &Fight, player: ActorId) -> Option<String> {
    let spec = openlogs_gamedata::spec(fight.actors.get(player).spec_id?)?;
    let class = openlogs_gamedata::class(spec.class_id)?;
    Some(format!("{} {}", spec.name, class.name))
}

pub fn player_detail_dto(
    fight: &Fight,
    curated: &Curated,
    detail: &PlayerDetail,
    metric: MetricDto,
    attribution: AttributionDto,
) -> PlayerDetailDto {
    let mut names = Names::new(fight).with_units(&detail.units);
    let support_received_from = names.amounts(&detail.support_received_from);
    let taken_by_spell = detail
        .taken_by_spell
        .iter()
        .map(|&(spell, environmental, amount)| TakenSpellDto {
            spell_id: names.spell(spell),
            amount,
            environmental,
        })
        .collect();
    let mut ability_dto = |a: &openlogs_analysis::PlayerAbility| PlayerAbilityDto {
        row: names.row(&a.row),
        casts: a.casts,
        aug: a.aug,
        pets: a.pets,
        support_from: names.buff_shares(&a.support_from),
        targets: names.targets(&a.targets),
        recipients: a
            .recipients
            .iter()
            .map(|r| SupportRecipientDto {
                player: names.player(r.player),
                amount: r.amount,
                abilities: r
                    .abilities
                    .iter()
                    .map(|&(ability, amount)| SupportedAbilityDto {
                        spell_id: ability.map(|a| names.spell(a.spell)),
                        pet_name: ability
                            .filter(|a| a.actor != r.player)
                            .and_then(|a| fight.actors.get(a.actor).name.clone()),
                        amount,
                    })
                    .collect(),
            })
            .collect(),
    };
    let abilities = detail.abilities.iter().map(&mut ability_dto).collect();
    let pet_abilities = detail.pet_abilities.iter().map(&mut ability_dto).collect();
    let targets = names.targets(&detail.targets);
    let mut context_spells: BTreeMap<SpellId, SpellRef> = BTreeMap::new();
    let deaths = detail
        .deaths
        .iter()
        .map(|entry| {
            let death = &entry.death;
            PlayerDeathDto {
                t: death.t,
                resurrected_at: death.resurrected_at,
                killing_blow: death.killing_blow.map(|hit| HitDto {
                    t: hit.t,
                    spell_id: names.spell(hit.spell),
                    source_name: (hit.source != NOBODY)
                        .then(|| fight.actors.get(hit.source).name.clone())
                        .flatten(),
                    amount: hit.amount,
                    overkill: hit.overkill,
                    environmental: hit.environmental,
                    periodic: hit.periodic,
                }),
                resurrected_by: death.resurrected_by.map(|rez| ResurrectionDto {
                    spell_id: names.spell(rez.spell),
                    source: (rez.source != NOBODY
                        && fight.actors.get(rez.source).kind == ActorKind::Player)
                        .then(|| names.player(rez.source)),
                }),
                lethal_burst: death.lethal_burst.map(|burst| LethalBurstDto {
                    spell_id: names.spell(burst.spell),
                    count: burst.count,
                    window_ms: burst.window_ms,
                }),
                context: context_dtos(
                    fight,
                    curated,
                    &without_shields(curated, &entry.context),
                    &mut context_spells,
                ),
            }
        })
        .collect();
    let consumables = detail
        .consumables
        .iter()
        .map(|u| PlayerConsumableDto {
            t: u.t,
            spell_id: names.spell(u.spell),
            kind: u.kind,
        })
        .collect();
    let cast_rows = detail
        .cast_rows
        .iter()
        .map(|row| CastRowDto {
            spell_id: names.spell(row.spell),
            kind: row.kind.into(),
            duration_ms: row.duration_ms,
            times: row.times.clone(),
            link: row.link.map(Into::into),
        })
        .collect();
    let cast_timeline = detail
        .cast_timeline
        .iter()
        .map(|row| CastRowDto {
            spell_id: names.spell(row.spell),
            kind: row.kind.into(),
            duration_ms: row.duration_ms,
            times: row.times.clone(),
            link: row.link.map(Into::into),
        })
        .collect();
    let buff_rows = detail
        .buff_rows
        .iter()
        .map(|row| BuffRowDto {
            spell_id: names.spell(row.spell),
            source: if fight.actors.get(row.source).kind == ActorKind::Player {
                names.player(row.source)
            } else {
                row.source
            },
            kind: row.kind.into(),
            intervals: row.intervals.iter().map(|&(a, b)| [a, b]).collect(),
            uptime: row.uptime,
        })
        .collect();
    if !detail.ebon_might.is_empty() {
        names.spell(EBON_MIGHT);
    }
    let augmentation = detail
        .augmentation
        .iter()
        .map(|a| AugTargetDto {
            player: names.player(a.player),
            support: a.support,
            ebon_might_uptime: a.ebon_might_uptime,
            prescience_uptime: a.prescience_uptime,
        })
        .collect();
    let (referenced, mut spells) = names.finish();
    // Consumables the context names but the log never cast (the curated representative).
    for (id, spell) in context_spells {
        spells.entry(id).or_insert(spell);
    }

    // Players with a spec for the switcher, plus every player the page names (an Evoker or
    // buff source without COMBATANT_INFO would otherwise show as "?").
    let mut roster: Vec<PlayerRef> = fight
        .actors
        .players()
        .filter(|actor| actor.spec_id.is_some())
        .map(|actor| player_ref(fight, actor.id))
        .collect();
    for player in referenced {
        if !roster.iter().any(|p| p.actor_id == player.actor_id) {
            roster.push(player);
        }
    }
    roster.sort_by(|a, b| a.name.cmp(&b.name));
    let actor = fight.actors.get(detail.player);

    PlayerDetailDto {
        player: player_ref(fight, detail.player),
        spec_name: spec_name(fight, detail.player),
        item_level: actor.item_level,
        max_hp: actor.max_hp,
        metric,
        attribution,
        start_ms: detail.start_ms,
        end_ms: detail.end_ms,
        total: detail.total,
        other_mode_total: detail.other_mode_total,
        per_second: detail.per_second,
        rank: detail.rank,
        ranked_players: detail.ranked_players,
        support_received: detail.support_received,
        support_received_from,
        healing_received: detail.healing_received,
        deaths,
        consumables,
        abilities,
        pet_abilities,
        taken_by_spell,
        series_step_ms: detail.series_step_ms,
        series: detail.series.clone(),
        cast_rows,
        cast_timeline,
        buff_rows,
        ebon_might: detail.ebon_might.iter().map(|&(a, b)| [a, b]).collect(),
        dead: detail.dead.iter().map(|&(a, b)| [a, b]).collect(),
        dead_since: detail.dead_since,
        augmentation,
        targets,
        color_groups: detail.color_groups.clone(),
        mana: detail.mana.clone(),
        roster,
        spells,
    }
}

#[cfg(test)]
mod tests {
    use openlogs_analysis::{Actors, Attribution, NOBODY, ReportFilter, player_detail};
    use openlogs_gamedata::Curated;

    use super::*;
    use crate::test_fight::{HOSTILE_FLAGS, PLAYER_FLAGS, damage_event, fight, unit};

    #[test]
    fn the_evokers_support_tree_names_players_pets_and_buffs() {
        let mut actors = Actors::new();
        let evoker = unit(
            &mut actors,
            "Player-1",
            "Speronis-Stonevale-EU",
            PLAYER_FLAGS,
        );
        actors.set_spec(evoker, 1473);
        let hunter = unit(&mut actors, "Player-2", "Corin-Ashgrove-EU", PLAYER_FLAGS);
        let wolf = unit(&mut actors, "Pet-0-1-1-1-1-01", "Wolf", 0x2114);
        actors.set_owner(wolf, hunter);
        let boss = unit(
            &mut actors,
            "Vehicle-0-1-1-1-257758-01",
            "Ula'tek",
            HOSTILE_FLAGS,
        );
        let fight = fight(
            actors,
            vec![
                damage_event(1_000, wolf, boss, 17253, 800, NOBODY),
                damage_event(1_000, wolf, boss, EBON_MIGHT, 80, evoker),
            ],
        );
        let detail = player_detail(
            &fight,
            &Curated::bundled(),
            evoker,
            Metric::Damage,
            &ReportFilter::whole(Attribution::Reattributed),
        )
        .unwrap();
        let dto = player_detail_dto(
            &fight,
            &Curated::bundled(),
            &detail,
            MetricDto::Damage,
            AttributionDto::Reattributed,
        );
        let ebon = &dto.abilities[0];
        assert_eq!(ebon.row.spell_id, EBON_MIGHT);
        assert_eq!(
            ebon.recipients,
            vec![SupportRecipientDto {
                player: hunter,
                amount: 80,
                abilities: vec![SupportedAbilityDto {
                    spell_id: Some(17253),
                    pet_name: Some("Wolf".into()),
                    amount: 80
                }]
            }]
        );
        assert!(dto.roster.iter().any(|p| p.actor_id == hunter));
        assert!(dto.spells.contains_key(&17253));
    }
}
