//! The dungeon table from trimmed real wago.tools exports.

use openlogs_gamedata::{DungeonBoss, DungeonTable, DungeonTableError, KeyTimer};

const MAP_CHALLENGE_MODE: &[u8] = include_bytes!("fixtures/MapChallengeMode.csv");
const DUNGEON_ENCOUNTER: &[u8] = include_bytes!("fixtures/DungeonEncounter.csv");
const KEYS_HEADER: &str = "ID,MapID,Name_lang,CriteriaCount_0,CriteriaCount_1,CriteriaCount_2\n";
const ENCOUNTERS_HEADER: &str = "Name_lang,ID,MapID,DifficultyID,OrderIndex\n";

fn table() -> DungeonTable {
    DungeonTable::from_csv(MAP_CHALLENGE_MODE, DUNGEON_ENCOUNTER).unwrap()
}

fn boss_ids(table: &DungeonTable, challenge_mode_id: u32) -> Option<Vec<u32>> {
    let bosses = table.dungeon(challenge_mode_id)?.bosses.as_ref()?;
    Some(bosses.iter().map(|boss| boss.encounter_id).collect())
}

#[test]
fn a_key_knows_its_map_name_time_limits_and_bosses_in_order() {
    let table = table();
    let priory = table.dungeon(499).unwrap();
    assert_eq!(
        (priory.map_id, priory.name.as_str()),
        (2649, "Priory of the Sacred Flame")
    );
    assert_eq!(priory.time_limits_s, [1950, 1560, 1170]);
    let boss = |encounter_id: u32, name: &str| DungeonBoss {
        encounter_id,
        name: name.to_string(),
    };
    assert_eq!(
        priory.bosses.as_deref(),
        Some(
            &[
                boss(2847, "Captain Dailcry"),
                boss(2835, "Baron Braunpyke"),
                boss(2848, "Prioress Murrpray"),
            ][..]
        )
    );
    assert_eq!(
        table.dungeon(503).unwrap().name,
        "Ara-Kara, City of Echoes",
        "a quoted name with a comma is read whole"
    );
    assert!(table.dungeon(9999).is_none());
}

#[test]
fn only_reliable_boss_lists_are_kept() {
    let table = table();
    // Dawn of the Infinite: two keys share one map. Siege of Boralus lists both faction bosses.
    // Neltharus has no encounter rows.
    for key in [463, 464, 353, 404] {
        assert_eq!(boss_ids(&table, key), None, "key {key}");
    }
    assert_eq!(
        table.dungeon(463).unwrap().time_limits_s,
        [2040, 1632, 1224]
    );
    for key in [239, 583] {
        assert_eq!(
            boss_ids(&table, key),
            Some(vec![2065, 2066, 2067, 2068]),
            "two keys of the same name share the map's bosses: {key}"
        );
    }
}

#[test]
fn bosses_are_the_rows_for_every_difficulty_or_mythic_keystone() {
    let keys = format!(
        "{KEYS_HEADER}900,9000,Test Dungeon,1800,1440,1080\n\
         247,1594,THE MOTHERLODE!!,2340,1872,1404\n"
    );
    // "Betarix Hotfixxle" (3463) is listed on THE MOTHERLODE!! but no key has had it.
    let encounters = format!(
        "{ENCOUNTERS_HEADER}Heroic Only,3,9000,2,500\n\
         Keystone Only,2,9000,8,1000\n\
         Every Difficulty,1,9000,0,0\n\
         Mythic Only,4,9000,23,1500\n\
         Mogul Razdunk,2108,1594,0,3000\n\
         Betarix Hotfixxle,3463,1594,0,4000\n"
    );
    let table = DungeonTable::from_csv(keys.as_bytes(), encounters.as_bytes()).unwrap();
    assert_eq!(boss_ids(&table, 900), Some(vec![1, 2]));
    assert_eq!(boss_ids(&table, 247), Some(vec![2108]));
}

#[test]
fn time_limits_need_a_falling_ladder_and_decide_the_timer() {
    let keys = format!(
        "{KEYS_HEADER}499,2649,Priory of the Sacred Flame,1950,1560,1170\n\
         901,9001,No Second Tier,1800,0,1080\n\
         902,9002,Repeated Limits,1200,1200,1200\n"
    );
    let table = DungeonTable::from_csv(keys.as_bytes(), DUNGEON_ENCOUNTER).unwrap();
    assert_eq!(table.dungeon(901).unwrap().time_limits_s, [1800]);
    assert!(table.dungeon(902).unwrap().time_limits_s.is_empty());
    assert_eq!(table.dungeon(902).unwrap().timer(600_000), None);

    let priory = table.dungeon(499).unwrap();
    for (ms, timer) in [
        (1_170_000, KeyTimer::InTime { upgrades: 3 }),
        (1_170_001, KeyTimer::InTime { upgrades: 2 }),
        (1_950_000, KeyTimer::InTime { upgrades: 1 }),
        (1_950_001, KeyTimer::OverTime),
    ] {
        assert_eq!(priory.timer(ms), Some(timer), "{ms} ms");
    }
}

#[test]
fn unusable_exports_are_rejected() {
    assert!(matches!(
        DungeonTable::from_csv(MAP_CHALLENGE_MODE, b"<!DOCTYPE html>\n"),
        Err(DungeonTableError::MissingColumn("ID"))
    ));
    assert!(matches!(
        DungeonTable::from_csv(KEYS_HEADER.as_bytes(), ENCOUNTERS_HEADER.as_bytes()),
        Err(DungeonTableError::Empty)
    ));
    assert!(matches!(
        DungeonTable::from_json("garbage"),
        Err(DungeonTableError::Stored(_))
    ));
}
