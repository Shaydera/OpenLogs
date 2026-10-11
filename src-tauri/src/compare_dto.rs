use openlogs_analysis::{ActorId, ComparedPlayer, Fight, PlayerSide, PullComparison};
use openlogs_gamedata::Curated;
use serde::Serialize;

use crate::overview_dto::{PlayerRef, QuickOverviewDto, player_ref, quick_overview_dto};

/// One pull of a comparison: its log index and its whole-pull overview.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullSideDto {
    pub fight_index: u32,
    pub overview: QuickOverviewDto,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerSideDto {
    /// The player's actor in this pull; ids differ between pulls.
    pub actor_id: ActorId,
    pub dps: f64,
    pub hps: f64,
    pub deaths: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparedPlayerDto {
    /// Name, class, spec and role from the later pull, unless only the earlier one knows
    /// the spec; `actorId` belongs to that pull.
    pub player: PlayerRef,
    pub a: Option<PlayerSideDto>,
    pub b: Option<PlayerSideDto>,
    /// DPS in B minus DPS in A; `None` unless the player was in both pulls.
    pub dps_delta: Option<f64>,
}

/// JSON shape mirrored by `PullComparison` in `ui/src/api/types.ts`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullComparisonDto {
    /// The earlier pull.
    pub a: PullSideDto,
    /// The later pull.
    pub b: PullSideDto,
    pub players: Vec<ComparedPlayerDto>,
}

fn side_dto(side: PlayerSide) -> PlayerSideDto {
    PlayerSideDto {
        actor_id: side.actor,
        dps: side.dps,
        hps: side.hps,
        deaths: side.deaths,
    }
}

fn has_spec(fight: &Fight, actor: ActorId) -> bool {
    fight.actors.get(actor).spec_id.is_some()
}

fn compared_player_dto(
    fight_a: &Fight,
    fight_b: &Fight,
    row: &ComparedPlayer,
) -> ComparedPlayerDto {
    let player = match (row.a, row.b) {
        (Some(a), Some(b)) if !has_spec(fight_b, b.actor) && has_spec(fight_a, a.actor) => {
            player_ref(fight_a, a.actor)
        }
        (_, Some(b)) => player_ref(fight_b, b.actor),
        (Some(a), None) => player_ref(fight_a, a.actor),
        (None, None) => unreachable!("a compared player was in at least one pull"),
    };
    ComparedPlayerDto {
        player,
        a: row.a.map(side_dto),
        b: row.b.map(side_dto),
        dps_delta: row.dps_delta(),
    }
}

/// `comparison` was computed from `fight_a` and `fight_b`; the indices are their log indices.
pub fn pull_comparison_dto(
    curated: &Curated,
    (index_a, fight_a): (u32, &Fight),
    (index_b, fight_b): (u32, &Fight),
    comparison: &PullComparison,
) -> PullComparisonDto {
    PullComparisonDto {
        a: PullSideDto {
            fight_index: index_a,
            overview: quick_overview_dto(fight_a, curated, &comparison.a),
        },
        b: PullSideDto {
            fight_index: index_b,
            overview: quick_overview_dto(fight_b, curated, &comparison.b),
        },
        players: comparison
            .players
            .iter()
            .map(|row| compared_player_dto(fight_a, fight_b, row))
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use openlogs_analysis::{Actors, Attribution, NOBODY, compare_pulls};
    use openlogs_gamedata::Curated;

    use super::*;
    use crate::test_fight::{HOSTILE_FLAGS, PLAYER_FLAGS, damage_event, fight, unit};

    #[test]
    fn names_each_player_once_with_the_spec_either_pull_knows() {
        // Pull A knows Faelan's spec; pull B has no COMBATANT_INFO for him.
        let mut actors_a = Actors::new();
        let faelan_a = unit(
            &mut actors_a,
            "Player-1",
            "Faelan-Emberfall-EU",
            PLAYER_FLAGS,
        );
        actors_a.set_spec(faelan_a, 62);
        let boss_a = unit(
            &mut actors_a,
            "Creature-0-1-1-1-1-01",
            "Ula'tek",
            HOSTILE_FLAGS,
        );
        let pull_a = fight(
            actors_a,
            vec![damage_event(1_000, faelan_a, boss_a, 44425, 20_000, NOBODY)],
        );
        let mut actors_b = Actors::new();
        let boss_b = unit(
            &mut actors_b,
            "Creature-0-1-1-1-1-02",
            "Ula'tek",
            HOSTILE_FLAGS,
        );
        let faelan_b = unit(
            &mut actors_b,
            "Player-1",
            "Faelan-Emberfall-EU",
            PLAYER_FLAGS,
        );
        let pull_b = fight(
            actors_b,
            vec![damage_event(1_000, faelan_b, boss_b, 44425, 40_000, NOBODY)],
        );
        let curated = Curated::bundled();
        let comparison = compare_pulls(&pull_a, &pull_b, &curated, Attribution::Augmented);

        let dto = pull_comparison_dto(&curated, (1, &pull_a), (3, &pull_b), &comparison);
        assert_eq!((dto.a.fight_index, dto.b.fight_index), (1, 3));
        assert_eq!(dto.players.len(), 1);
        let faelan = &dto.players[0];
        assert_eq!(
            (faelan.player.name.as_str(), faelan.player.spec_id),
            ("Faelan-Emberfall-EU", Some(62))
        );
        assert_eq!(
            faelan.player.actor_id, faelan_a,
            "named from the pull that knows the spec"
        );
        assert_eq!(
            (faelan.a.unwrap().actor_id, faelan.b.unwrap().actor_id),
            (faelan_a, faelan_b)
        );
        assert_eq!(faelan.dps_delta, Some(1_000.0), "40k − 20k over 20 s");

        let json = serde_json::to_value(&dto).unwrap();
        assert!(json["players"][0].get("dpsDelta").is_some());
        assert!(json["players"][0]["b"].get("actorId").is_some());
        assert!(json["a"]["overview"]["timeline"].get("bossHp").is_some());
        assert_eq!(json["b"]["fightIndex"], 3);
    }
}
