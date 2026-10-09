use std::collections::{BTreeMap, BTreeSet};

use openlogs_analysis::{
    AbilityDetail, ActorId, ActorKind, EnemyGroup, Fight, SpellId, TargetDetail,
};
use serde::Serialize;

use crate::overview_dto::{PlayerRef, player_ref};
use crate::player_dto::MetricDto;
use crate::report_dto::PlayerAmount;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AbilityHitDto {
    pub t: i32,
    pub target: ActorId,
    pub amount: u64,
    pub critical: bool,
    pub periodic: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetHitsDto {
    pub name: String,
    pub hits: u32,
    pub crits: u32,
    pub amount: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AbilityDetailDto {
    pub player: PlayerRef,
    pub spell_id: SpellId,
    pub spell_name: String,
    /// Spell school bit mask (1 physical, 2 holy, 4 fire, 8 nature, 16 frost, 32 shadow, 64 arcane).
    pub school: u32,
    pub pet: Option<String>,
    pub metric: MetricDto,
    pub start_ms: i32,
    pub end_ms: i32,
    pub total: u64,
    pub player_total: u64,
    pub casts: Vec<i32>,
    pub hits: Vec<AbilityHitDto>,
    pub by_target: Vec<TargetHitsDto>,
    pub median: u64,
    pub uptime: Option<f64>,
    pub dead: Vec<[i32; 2]>,
    /// Names of the units in `hits`, keyed by actor id.
    pub target_names: BTreeMap<ActorId, String>,
    /// Names in `target_names` that belong to players; only these are shortened in the UI.
    pub player_targets: Vec<String>,
}

pub fn ability_detail_dto(
    fight: &Fight,
    detail: &AbilityDetail,
    metric: MetricDto,
) -> AbilityDetailDto {
    let info = fight.spells.get(&detail.spell);
    let target_names = detail
        .hits
        .iter()
        .map(|hit| {
            let actor = fight.actors.get(hit.target);
            (
                hit.target,
                actor.name.clone().unwrap_or_else(|| actor.guid.clone()),
            )
        })
        .collect();
    let player_targets: BTreeSet<String> = detail
        .hits
        .iter()
        .filter(|hit| fight.actors.get(hit.target).kind == ActorKind::Player)
        .map(|hit| {
            let actor = fight.actors.get(hit.target);
            actor.name.clone().unwrap_or_else(|| actor.guid.clone())
        })
        .collect();
    AbilityDetailDto {
        player: player_ref(fight, detail.player),
        spell_id: detail.spell,
        spell_name: info.map_or_else(String::new, |i| i.name.clone()),
        school: info.map_or(0, |i| i.school),
        pet: detail.pet.clone(),
        metric,
        start_ms: detail.start_ms,
        end_ms: detail.end_ms,
        total: detail.total,
        player_total: detail.player_total,
        casts: detail.casts.clone(),
        hits: detail
            .hits
            .iter()
            .map(|h| AbilityHitDto {
                t: h.t,
                target: h.target,
                amount: h.amount,
                critical: h.critical,
                periodic: h.periodic,
            })
            .collect(),
        by_target: detail
            .by_target
            .iter()
            .map(|t| TargetHitsDto {
                name: t.name.clone(),
                hits: t.hits,
                crits: t.crits,
                amount: t.amount,
            })
            .collect(),
        median: detail.median,
        uptime: detail.uptime,
        dead: detail.dead.iter().map(|&(a, b)| [a, b]).collect(),
        target_names,
        player_targets: player_targets.into_iter().collect(),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnemyGroupDto {
    pub name: String,
    pub units: u32,
    pub damage_taken: u64,
    pub is_boss: bool,
    /// The encounter's main boss: its portrait belongs here.
    pub primary: bool,
    pub shares_boss_hp: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitLifeDto {
    pub actor: ActorId,
    pub first_hit: i32,
    pub last_hit: i32,
    pub death: Option<i32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveDto {
    pub start_ms: i32,
    pub units: u32,
    pub killed: u32,
    pub clear_ms: i32,
    pub avg_life_ms: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetDetailDto {
    pub name: String,
    pub start_ms: i32,
    pub end_ms: i32,
    pub damage_taken: u64,
    pub raid_damage: u64,
    pub max_hp: Option<u64>,
    pub is_boss: bool,
    /// The encounter's main boss: its portrait belongs here.
    pub primary: bool,
    pub shares_boss_hp: bool,
    pub units: Vec<UnitLifeDto>,
    pub waves: Vec<WaveDto>,
    pub by_player: Vec<PlayerAmount>,
    pub enemies: Vec<EnemyGroupDto>,
    pub roster: Vec<PlayerRef>,
}

pub fn target_detail_dto(
    fight: &Fight,
    detail: &TargetDetail,
    enemies: &[EnemyGroup],
) -> TargetDetailDto {
    TargetDetailDto {
        name: detail.name.clone(),
        start_ms: detail.start_ms,
        end_ms: detail.end_ms,
        damage_taken: detail.damage_taken,
        raid_damage: detail.raid_damage,
        max_hp: detail.max_hp,
        is_boss: detail.is_boss,
        primary: detail.primary,
        shares_boss_hp: detail.shares_boss_hp,
        units: detail
            .units
            .iter()
            .map(|u| UnitLifeDto {
                actor: u.actor,
                first_hit: u.first_hit,
                last_hit: u.last_hit,
                death: u.death,
            })
            .collect(),
        waves: detail
            .waves
            .iter()
            .map(|w| WaveDto {
                start_ms: w.start_ms,
                units: w.units,
                killed: w.killed,
                clear_ms: w.clear_ms,
                avg_life_ms: w.avg_life_ms,
            })
            .collect(),
        by_player: detail
            .by_player
            .iter()
            .map(|&(player, amount)| PlayerAmount { player, amount })
            .collect(),
        enemies: enemies
            .iter()
            .map(|g| EnemyGroupDto {
                name: g.name.clone(),
                units: g.units,
                damage_taken: g.damage_taken,
                is_boss: g.is_boss,
                primary: g.primary,
                shares_boss_hp: g.shares_boss_hp,
            })
            .collect(),
        roster: detail
            .by_player
            .iter()
            .map(|&(player, _)| player_ref(fight, player))
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use openlogs_analysis::{Actors, Attribution, Metric, ReportFilter, ability_detail};

    use super::*;
    use crate::test_fight::{PLAYER_FLAGS, fight, heal_event, unit};

    #[test]
    fn only_players_are_listed_as_player_targets() {
        let mut actors = Actors::new();
        let priest = unit(&mut actors, "Player-1", "Ulvara-Emberfall-EU", PLAYER_FLAGS);
        actors.set_spec(priest, 256);
        let mage = unit(&mut actors, "Player-2", "Faelan-Emberfall-EU", PLAYER_FLAGS);
        let ward = unit(&mut actors, "Creature-0-1-1-1-9-01", "Ky-Veth Ward", 0xa18);
        let fight = fight(
            actors,
            vec![
                heal_event(1_000, priest, mage, 2061, 500),
                heal_event(2_000, priest, ward, 2061, 300),
            ],
        );
        let detail = ability_detail(
            &fight,
            &openlogs_gamedata::Curated::bundled(),
            priest,
            2061,
            None,
            Metric::Healing,
            &ReportFilter::whole(Attribution::Augmented),
        )
        .unwrap();
        let dto = ability_detail_dto(&fight, &detail, MetricDto::Healing);
        assert_eq!(dto.player_targets, vec!["Faelan-Emberfall-EU".to_string()]);
        assert!(dto.target_names.values().any(|name| name == "Ky-Veth Ward"));
    }
}
