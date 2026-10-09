use std::collections::BTreeMap;

use openlogs_analysis::{
    ActorId, ContextItem, ContextState, Death, DeathContext, Fight, NO_SPELL, NOBODY, PhaseKind,
    QuickOverview, SpellId,
};
use openlogs_gamedata::{ConsumableKind, CooldownCategory, Curated, Role};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickOverviewDto {
    pub kpis: KpisDto,
    pub timeline: TimelineDto,
    /// Roster players plus anyone referenced by deaths, consumables or cooldowns.
    pub players: Vec<PlayerRef>,
    /// Names of every spell the overview references (0 = melee is not included).
    pub spells: BTreeMap<SpellId, SpellRef>,
    pub deaths: Vec<DeathDto>,
    pub consumables: Vec<ConsumableDto>,
    pub cooldowns: Vec<CooldownDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KpisDto {
    pub players: u32,
    pub duration_ms: u64,
    pub raid_damage: u64,
    pub raid_dps: f64,
    pub deaths: u32,
    pub first_death_ms: Option<i32>,
    pub combat_potions: u32,
    pub players_without_combat_potion: u32,
    pub healthstones: u32,
    pub health_potions: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineDto {
    pub boss_hp_step_ms: u32,
    pub boss_hp: Vec<Option<f32>>,
    pub dps_step_ms: u32,
    pub raid_dps: Vec<f64>,
    pub phases: Vec<PhaseDto>,
    /// Whole-pull markers, whatever the range.
    pub markers: MarkersDto,
    /// The whole pull's duration: `kpis.durationMs` follows the range.
    pub duration_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeathMarkerDto {
    pub t: i32,
    pub player: ActorId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LustMarkerDto {
    pub t: i32,
    pub player: ActorId,
    pub spell_id: SpellId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CastMarkerDto {
    pub t: i32,
    pub spell_id: SpellId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkersDto {
    pub deaths: Vec<DeathMarkerDto>,
    pub bloodlust: Vec<LustMarkerDto>,
    pub boss_casts: Vec<CastMarkerDto>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PhaseKindDto {
    Boss,
    Intermission,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseDto {
    pub kind: PhaseKindDto,
    pub number: u32,
    pub start_ms: u32,
    pub end_ms: u32,
    /// From a phase config; `None` for detected phases.
    pub name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerRef {
    pub actor_id: ActorId,
    pub name: String,
    pub spec_id: Option<u32>,
    /// E.g. "Arcane Mage"; `None` without a known spec.
    pub spec_name: Option<String>,
    pub class_id: Option<u32>,
    pub class_token: Option<String>,
    pub role: Option<Role>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SpellRef {
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeathDto {
    pub player: ActorId,
    pub player_name: String,
    pub t: i32,
    pub killing_blow: Option<HitDto>,
    pub damage_last_5s: Vec<AbilityAmountDto>,
    pub damage_taken_5s: u64,
    pub healing_taken_5s: u64,
    pub hp_before_pct: Option<f32>,
    pub resurrected_at: Option<i32>,
    pub context: Vec<ContextDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HitDto {
    pub t: i32,
    /// 0 = melee.
    pub spell_id: SpellId,
    /// `None` for environmental or source-less damage.
    pub source_name: Option<String>,
    pub amount: u64,
    pub overkill: u64,
    /// Falling, lava, drowning and other world damage.
    pub environmental: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AbilityAmountDto {
    pub spell_id: SpellId,
    pub amount: u64,
    /// World damage, kept apart from melee (both spell 0).
    pub environmental: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextItemDto {
    Healthstone,
    HealthPotion,
    /// The player's combat potion while its cooldown runs at the death.
    CombatPotion,
    Defensive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextStateDto {
    Used,
    OnCooldown,
    Available,
    /// A personal defensive not used once before the death although it would have been ready again.
    NeverUsed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextDto {
    pub item: ContextItemDto,
    /// Spell for name and icon: the stone or potion used, else the item's representative spell.
    pub spell_id: SpellId,
    pub state: ContextStateDto,
    /// Time of the use for `used` and `on_cooldown`.
    pub t: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsumableDto {
    pub player: ActorId,
    pub t: i32,
    pub spell_id: SpellId,
    pub kind: ConsumableKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CooldownDto {
    pub player: ActorId,
    pub t: i32,
    pub spell_id: SpellId,
    pub category: CooldownCategory,
    pub duration_ms: u32,
}

/// Spell shown for a consumable context item that has no use to point at.
fn representative_consumable(curated: &Curated, kind: ConsumableKind) -> (SpellId, String) {
    curated
        .consumables
        .consumables
        .iter()
        .find(|item| item.kind == kind)
        .map_or((NO_SPELL, String::new()), |item| {
            (item.spell_id, item.name.clone())
        })
}

/// The spell a consumable context item shows — the one used, else the item's representative
/// spell — noted in `spells` with the curated name as the fallback.
fn consumable_spell(
    fight: &Fight,
    curated: &Curated,
    spells: &mut BTreeMap<SpellId, SpellRef>,
    kind: ConsumableKind,
    used: Option<SpellId>,
) -> SpellId {
    let (id, name) = used.map_or_else(
        || representative_consumable(curated, kind),
        |id| {
            let name = curated
                .consumables
                .consumables
                .iter()
                .find(|item| item.spell_id == id)
                .map_or(String::new(), |item| item.name.clone());
            (id, name)
        },
    );
    note_spell(fight, spells, id, &name);
    id
}

fn note_spell(
    fight: &Fight,
    spells: &mut BTreeMap<SpellId, SpellRef>,
    id: SpellId,
    fallback: &str,
) {
    if id == NO_SPELL {
        return;
    }
    let name = fight
        .spells
        .get(&id)
        .map_or_else(|| fallback.to_string(), |info| info.name.clone());
    spells.entry(id).or_insert(SpellRef { name });
}

fn actor_name(fight: &Fight, id: ActorId) -> String {
    let actor = fight.actors.get(id);
    actor.name.clone().unwrap_or_else(|| actor.guid.clone())
}

/// The death context for the UI, noting every spell it references in `spells`.
pub(crate) fn context_dtos(
    fight: &Fight,
    curated: &Curated,
    context: &[DeathContext],
    spells: &mut BTreeMap<SpellId, SpellRef>,
) -> Vec<ContextDto> {
    context
        .iter()
        .map(|entry| {
            let (item, spell_id) = match entry.item {
                ContextItem::Healthstone => (
                    ContextItemDto::Healthstone,
                    consumable_spell(
                        fight,
                        curated,
                        spells,
                        ConsumableKind::Healthstone,
                        entry.spell,
                    ),
                ),
                ContextItem::HealthPotion => (
                    ContextItemDto::HealthPotion,
                    consumable_spell(
                        fight,
                        curated,
                        spells,
                        ConsumableKind::HealthPotion,
                        entry.spell,
                    ),
                ),
                ContextItem::CombatPotion => (
                    ContextItemDto::CombatPotion,
                    consumable_spell(
                        fight,
                        curated,
                        spells,
                        ConsumableKind::CombatPotion,
                        entry.spell,
                    ),
                ),
                ContextItem::Defensive(id) => {
                    let name = curated
                        .defensives
                        .defensives
                        .iter()
                        .find(|d| d.spell_id == id)
                        .map_or(String::new(), |d| d.name.clone());
                    note_spell(fight, spells, id, &name);
                    (ContextItemDto::Defensive, id)
                }
            };
            let (state, t) = match entry.state {
                ContextState::Used { t } => (ContextStateDto::Used, Some(t)),
                ContextState::OnCooldown { used_at } => {
                    (ContextStateDto::OnCooldown, Some(used_at))
                }
                ContextState::Available => (ContextStateDto::Available, None),
                ContextState::NeverUsed => (ContextStateDto::NeverUsed, None),
            };
            ContextDto {
                item,
                spell_id,
                state,
                t,
            }
        })
        .collect()
}

/// One death with its context, noting every spell it references in `spells`.
pub fn death_dto(
    fight: &Fight,
    curated: &Curated,
    death: &Death,
    context: &[DeathContext],
    spells: &mut BTreeMap<SpellId, SpellRef>,
) -> DeathDto {
    let killing_blow = death.killing_blow.map(|hit| {
        note_spell(fight, spells, hit.spell, "");
        HitDto {
            t: hit.t,
            spell_id: hit.spell,
            source_name: (hit.source != NOBODY).then(|| actor_name(fight, hit.source)),
            amount: hit.amount,
            overkill: hit.overkill,
            environmental: hit.environmental,
        }
    });
    let damage_last_5s = death
        .damage_last_5s
        .iter()
        .map(|a| {
            note_spell(fight, spells, a.spell, "");
            AbilityAmountDto {
                spell_id: a.spell,
                amount: a.amount,
                environmental: a.environmental,
            }
        })
        .collect();
    let context = context_dtos(fight, curated, context, spells);
    DeathDto {
        player: death.player,
        player_name: actor_name(fight, death.player),
        t: death.t,
        killing_blow,
        damage_last_5s,
        damage_taken_5s: death.damage_taken_5s,
        healing_taken_5s: death.healing_taken_5s,
        hp_before_pct: death.hp_5s_before_pct,
        resurrected_at: death.resurrected_at,
        context,
    }
}

pub fn quick_overview_dto(
    fight: &Fight,
    curated: &Curated,
    overview: &QuickOverview,
) -> QuickOverviewDto {
    let mut spells: BTreeMap<SpellId, SpellRef> = BTreeMap::new();

    let deaths = overview
        .deaths
        .iter()
        .map(|report| death_dto(fight, curated, &report.death, &report.context, &mut spells))
        .collect();

    let consumables: Vec<ConsumableDto> = overview
        .consumables
        .iter()
        .map(|u| {
            note_spell(fight, &mut spells, u.spell, "");
            ConsumableDto {
                player: u.player,
                t: u.t,
                spell_id: u.spell,
                kind: u.kind,
            }
        })
        .collect();
    let cooldowns: Vec<CooldownDto> = overview
        .cooldowns
        .iter()
        .map(|u| {
            note_spell(fight, &mut spells, u.spell, "");
            CooldownDto {
                player: u.player,
                t: u.t,
                spell_id: u.spell,
                category: u.category,
                duration_ms: u.duration_ms,
            }
        })
        .collect();

    let mut player_ids: Vec<ActorId> = fight
        .actors
        .players()
        .filter(|p| p.spec_id.is_some())
        .map(|p| p.id)
        .collect();
    for id in overview
        .deaths
        .iter()
        .map(|d| d.death.player)
        .chain(overview.consumables.iter().map(|u| u.player))
        .chain(overview.cooldowns.iter().map(|u| u.player))
        // Markers cover the whole pull, so their players may be missing from the range lists.
        .chain(
            overview
                .timeline
                .markers
                .deaths
                .iter()
                .map(|&(_, player)| player),
        )
        .chain(
            overview
                .timeline
                .markers
                .bloodlust
                .iter()
                .map(|&(_, player, _)| player),
        )
    {
        if !player_ids.contains(&id) {
            player_ids.push(id);
        }
    }
    let players = player_ids
        .into_iter()
        .map(|id| player_ref(fight, id))
        .collect();

    let k = &overview.kpis;
    let m = &overview.timeline.markers;
    for &(_, _, spell) in &m.bloodlust {
        note_spell(fight, &mut spells, spell, "");
    }
    for &(_, spell) in &m.boss_casts {
        note_spell(fight, &mut spells, spell, "");
    }
    let markers = MarkersDto {
        deaths: m
            .deaths
            .iter()
            .map(|&(t, player)| DeathMarkerDto { t, player })
            .collect(),
        bloodlust: m
            .bloodlust
            .iter()
            .map(|&(t, player, spell_id)| LustMarkerDto {
                t,
                player,
                spell_id,
            })
            .collect(),
        boss_casts: m
            .boss_casts
            .iter()
            .map(|&(t, spell_id)| CastMarkerDto { t, spell_id })
            .collect(),
    };
    QuickOverviewDto {
        kpis: KpisDto {
            players: k.players,
            duration_ms: k.duration_ms,
            raid_damage: k.raid_damage,
            raid_dps: k.raid_dps,
            deaths: k.deaths,
            first_death_ms: k.first_death_ms,
            combat_potions: k.combat_potions,
            players_without_combat_potion: k.players_without_combat_potion,
            healthstones: k.healthstones,
            health_potions: k.health_potions,
        },
        timeline: TimelineDto {
            boss_hp_step_ms: overview.timeline.boss_hp_step_ms,
            boss_hp: overview.timeline.boss_hp.clone(),
            dps_step_ms: overview.timeline.dps_step_ms,
            raid_dps: overview.timeline.raid_dps.clone(),
            phases: overview
                .timeline
                .phases
                .iter()
                .map(|p| PhaseDto {
                    kind: match p.kind {
                        PhaseKind::Boss => PhaseKindDto::Boss,
                        PhaseKind::Intermission => PhaseKindDto::Intermission,
                    },
                    number: p.number,
                    start_ms: p.start_ms,
                    end_ms: p.end_ms,
                    name: p.name.clone(),
                })
                .collect(),
            markers,
            duration_ms: fight.duration_ms,
        },
        players,
        spells,
        deaths,
        consumables,
        cooldowns,
    }
}

/// Name, class, spec and role of an actor for the UI.
pub fn player_ref(fight: &Fight, id: ActorId) -> PlayerRef {
    let actor = fight.actors.get(id);
    let spec = actor.spec_id.and_then(openlogs_gamedata::spec);
    let class = spec.and_then(|spec| openlogs_gamedata::class(spec.class_id));
    PlayerRef {
        actor_id: id,
        name: actor.name.clone().unwrap_or_else(|| actor.guid.clone()),
        spec_id: actor.spec_id,
        spec_name: crate::player_dto::spec_name(fight, id),
        class_id: class.map(|c| c.id),
        class_token: class.map(|c| c.token.clone()),
        role: spec.map(|s| s.role),
    }
}

#[cfg(test)]
mod tests {
    use openlogs_analysis::{Actors, SpellInfo};

    use super::*;
    use crate::test_fight::{PLAYER_FLAGS, fight, unit};

    fn death_of(player: ActorId, t: i32) -> Death {
        Death {
            player,
            t,
            killing_blow: None,
            damage_last_5s: Vec::new(),
            damage_taken_5s: 0,
            healing_taken_5s: 0,
            hp_5s_before_pct: None,
            resurrected_at: None,
            resurrected_by: None,
            dead_until: None,
            lethal_burst: None,
        }
    }

    #[test]
    fn death_context_names_each_spell_from_the_log_or_the_curated_lists() {
        let mut actors = Actors::new();
        let mage = unit(&mut actors, "Player-1", "Faelan-Emberfall-EU", PLAYER_FLAGS);
        actors.set_spec(mage, 62);
        let mut fight = fight(actors, Vec::new());
        // A newer tier's healthstone, matched by its name pattern and not in the curated list.
        let ancient_healthstone = 1_400_001;
        for (id, name) in [
            (1236994, "Potion of Recklessness"),
            (ancient_healthstone, "Ancient Healthstone"),
        ] {
            fight.spells.insert(
                id,
                SpellInfo {
                    name: name.into(),
                    school: 1,
                },
            );
        }
        let entry = |item, state, spell| DeathContext { item, state, spell };
        let context = [
            entry(
                ContextItem::Defensive(414658),
                ContextState::NeverUsed,
                None,
            ),
            entry(ContextItem::HealthPotion, ContextState::Available, None),
            entry(
                ContextItem::CombatPotion,
                ContextState::OnCooldown { used_at: 30_000 },
                Some(1236994),
            ),
            entry(
                ContextItem::Healthstone,
                ContextState::Used { t: 41_000 },
                Some(ancient_healthstone),
            ),
        ];
        let curated = Curated::bundled();
        let mut spells = BTreeMap::new();
        let dto = death_dto(
            &fight,
            &curated,
            &death_of(mage, 45_000),
            &context,
            &mut spells,
        );
        let rows: Vec<_> = dto
            .context
            .iter()
            .map(|c| (c.item, c.state, c.t, spells[&c.spell_id].name.as_str()))
            .collect();
        let representative_potion = curated
            .consumables
            .consumables
            .iter()
            .find(|c| c.kind == ConsumableKind::HealthPotion)
            .map(|c| c.name.as_str());
        assert_eq!(
            rows,
            [
                (
                    ContextItemDto::Defensive,
                    ContextStateDto::NeverUsed,
                    None,
                    "Ice Cold"
                ),
                (
                    ContextItemDto::HealthPotion,
                    ContextStateDto::Available,
                    None,
                    representative_potion.unwrap()
                ),
                (
                    ContextItemDto::CombatPotion,
                    ContextStateDto::OnCooldown,
                    Some(30_000),
                    "Potion of Recklessness"
                ),
                (
                    ContextItemDto::Healthstone,
                    ContextStateDto::Used,
                    Some(41_000),
                    "Ancient Healthstone"
                ),
            ]
        );
    }
}
