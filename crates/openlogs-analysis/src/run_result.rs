//! The result of a Mythic+ run decided with the game's dungeon data. Without that data the
//! index's result stands.

use std::collections::HashSet;

use openlogs_gamedata::{DungeonTable, KeyTimer};
use openlogs_index::{FightSummary, Outcome};

/// Bosses of the dungeon with a kill in the run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BossProgress {
    pub killed: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RunResult {
    /// `Kill` = completed, `Wipe` = not completed, `Incomplete` = no end in the log.
    pub outcome: Outcome,
    /// `None` when the dungeon's boss list is unknown.
    pub bosses: Option<BossProgress>,
    /// Only for a run completed by the boss list with a logged time.
    pub timer: Option<KeyTimer>,
}

/// The result of `run` (an entry with `challenge`) among the index's `fights`.
///
/// With a boss list for the key: completed exactly when every boss of the dungeon has a
/// killed boss pull in the run and the logged time is not 0; otherwise not completed with
/// a `CHALLENGE_MODE_END`, incomplete without. A completed run with a logged time gets its
/// timer. Without dungeon data, an unknown key or no boss list, the index's outcome stays,
/// with no bosses and no timer.
pub fn run_result(
    run: &FightSummary,
    fights: &[FightSummary],
    dungeons: Option<&DungeonTable>,
) -> RunResult {
    let index_result = RunResult {
        outcome: run.outcome,
        bosses: None,
        timer: None,
    };
    let Some(challenge) = &run.challenge else {
        return index_result;
    };
    let Some(dungeon) = dungeons.and_then(|table| table.dungeon(challenge.challenge_mode_id))
    else {
        return index_result;
    };
    let Some(bosses) = &dungeon.bosses else {
        return index_result;
    };
    let kills: HashSet<u32> = fights
        .iter()
        .filter(|fight| fight.run_index == Some(run.index) && fight.outcome == Outcome::Kill)
        .map(|fight| fight.encounter_id)
        .collect();
    let killed = bosses
        .iter()
        .filter(|boss| kills.contains(&boss.encounter_id))
        .count() as u32;
    let total = bosses.len() as u32;
    // An abandoned key logs 0; that holds even after the last boss.
    let completed = killed == total && challenge.total_time_ms != Some(0);
    let outcome = match (completed, challenge.total_time_ms) {
        (true, _) => Outcome::Kill,
        (false, Some(_)) => Outcome::Wipe,
        (false, None) => Outcome::Incomplete,
    };
    let timer = challenge
        .total_time_ms
        .filter(|_| completed)
        .and_then(|ms| dungeon.timer(ms));
    RunResult {
        outcome,
        bosses: Some(BossProgress { killed, total }),
        timer,
    }
}
