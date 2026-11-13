use openlogs_index::{CombatPull, FightSummary, Indexer, Outcome, index_bytes};
use openlogs_parser::Timestamp;

/// Open world in Tirisfal Glades: the logging rogue kills one Vile Fin Minor Oracle while
/// players outside the group fight Puddlejumpers and Mongrels around them.
const FOREVER: &str = include_str!("fixtures/forever_open_world.txt");
const MYTHIC_PLUS: &str = include_str!("fixtures/mythic_plus.txt");
const MINI_RAID: &str = include_str!("fixtures/mini_raid.txt");

const FAELAN: Unit = Unit {
    guid: "Player-4101-8E8C0182",
    name: "Faelan-Emberfall-EU",
    flags: "0x512",
};
const PYRRIN: Unit = Unit {
    guid: "Player-4101-77D4A765",
    name: "Pyrrin-Emberfall-EU",
    flags: "0x514",
};
const STRANGER: Unit = Unit {
    guid: "Player-4101-0A0B0C0D",
    name: "Stranger-Emberfall-EU",
    flags: "0x518",
};
const KNIGHT: Unit = Unit {
    guid: "Creature-0-3892-2649-1387-206698-0000468001",
    name: "Arathi Knight",
    flags: "0xa48",
};
const DAILCRY: Unit = Unit {
    guid: "Creature-0-3892-2649-1387-207946-0000468002",
    name: "Captain Dailcry",
    flags: "0x10a48",
};
const FOOTMAN: Unit = Unit {
    guid: "Creature-0-3892-2649-1387-206699-0000468002",
    name: "Arathi Footman",
    flags: "0xa48",
};
const WOLF: Unit = Unit {
    guid: "Pet-0-3892-2649-1387-165189-0102C3D4E5",
    name: "Wolf",
    flags: "0x1111",
};

struct Unit {
    guid: &'static str,
    name: &'static str,
    flags: &'static str,
}

fn hit(ts: &str, source: &Unit, target: &Unit, amount: u64) -> String {
    let (s, t) = (source, target);
    format!(
        "{ts}  SPELL_DAMAGE,{},\"{}\",{},0x80000000,{},\"{}\",{},0x80000000,44425,\"Arcane Barrage\",0x40,{},0000000000000000,1000,50000000,0,0,0,0,0,0,1,0,0,0,1590.00,-3.00,2308,1.0000,80,{amount},{amount},-1,64,0,0,0,nil,nil,nil,ST\n",
        s.guid, s.name, s.flags, t.guid, t.name, t.flags, t.guid
    )
}

fn died(ts: &str, unit: &Unit) -> String {
    format!(
        "{ts}  UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,{},\"{}\",{},0x80000000,0\n",
        unit.guid, unit.name, unit.flags
    )
}

fn buff(ts: &str) -> String {
    format!(
        "{ts}  SPELL_AURA_APPLIED,{},\"{}\",{},0x80000000,{},\"{}\",{},0x80000000,774,\"Rejuvenation\",0x8,BUFF\n",
        PYRRIN.guid, PYRRIN.name, PYRRIN.flags, PYRRIN.guid, PYRRIN.name, PYRRIN.flags
    )
}

fn ts(text: &str) -> Timestamp {
    Timestamp::parse(text).unwrap()
}

fn combat_pulls(fights: &[FightSummary]) -> Vec<&FightSummary> {
    fights.iter().filter(|fight| fight.is_combat()).collect()
}

#[test]
fn forever_open_world_is_one_killed_pull() {
    let index = index_bytes(FOREVER.as_bytes());
    assert_eq!(index.broken_lines, 0);
    let pulls = combat_pulls(&index.fights);
    assert_eq!(pulls.len(), 1, "{:?}", index.fights);
    let pull = pulls[0];
    assert_eq!(
        (pull.outcome, pull.name.as_str()),
        (Outcome::Kill, "Vile Fin Minor Oracle")
    );
    assert_eq!(pull.combat, Some(CombatPull { enemy_count: 1 }));
    assert!(
        (11_700..=11_900).contains(&pull.duration_ms),
        "{}",
        pull.duration_ms
    );
    assert_eq!(
        (
            pull.encounter_id,
            pull.boss_hp_percent,
            pull.instance_id,
            pull.zone.as_deref()
        ),
        (0, None, 0, Some("Tirisfal Glades"))
    );
    let roster: Vec<_> = pull
        .roster
        .iter()
        .map(|entry| entry.guid.as_str())
        .collect();
    assert!(roster.contains(&"Player-6949-0066C9DA"), "{roster:?}");
    assert!(
        roster.contains(&"Player-6941-006597A9"),
        "an outsider fighting a Puddlejumper meanwhile: {roster:?}"
    );
}

#[test]
fn outsiders_neither_start_nor_hold_a_pull() {
    let alone = [
        hit("10/8/2026 20:00:00.0000", &STRANGER, &KNIGHT, 100),
        died("10/8/2026 20:00:05.0000", &KNIGHT),
    ]
    .concat();
    assert!(index_bytes(alone.as_bytes()).fights.is_empty());

    let beside_us = [
        hit("10/8/2026 20:00:00.0000", &FAELAN, &KNIGHT, 100),
        hit("10/8/2026 20:00:08.0000", &STRANGER, &KNIGHT, 100),
        hit("10/8/2026 20:00:16.0000", &STRANGER, &KNIGHT, 100),
        buff("10/8/2026 20:00:24.0000"),
    ]
    .concat();
    let index = index_bytes(beside_us.as_bytes());
    assert_eq!(index.fights.len(), 1);
    let pull = &index.fights[0];
    assert_eq!(
        (pull.outcome, pull.end),
        (Outcome::Ended, ts("10/8/2026 20:00:00.0000"))
    );
    let roster: Vec<_> = pull
        .roster
        .iter()
        .map(|entry| entry.guid.as_str())
        .collect();
    assert_eq!(
        roster,
        [FAELAN.guid],
        "the outsider fought only after the pull's last exchange"
    );
}

#[test]
fn packs_with_a_short_gap_are_two_pulls() {
    let data = [
        hit("10/8/2026 20:00:00.0000", &FAELAN, &KNIGHT, 100),
        died("10/8/2026 20:00:03.0000", &KNIGHT),
        hit("10/8/2026 20:00:08.0000", &FAELAN, &FOOTMAN, 100),
        died("10/8/2026 20:00:10.0000", &FOOTMAN),
    ]
    .concat();
    let index = index_bytes(data.as_bytes());
    let pulls: Vec<_> = index
        .fights
        .iter()
        .map(|fight| (fight.index, fight.name.clone(), fight.outcome))
        .collect();
    assert_eq!(
        pulls,
        [
            (1, "Arathi Knight".to_string(), Outcome::Kill),
            (2, "Arathi Footman".to_string(), Outcome::Kill),
        ]
    );
    assert_eq!(
        index.fights[1].prelude_offset, index.fights[0].end_offset,
        "a prelude never reaches into the previous pull"
    );
}

#[test]
fn boss_units_open_no_combat_pull_right_after_the_boss_pull_or_once_dead() {
    let data = [
        "10/8/2026 20:01:00.0000  ENCOUNTER_START,2847,\"Captain Dailcry\",8,5,2649
"
        .to_string(),
        hit("10/8/2026 20:01:10.0000", &FAELAN, &KNIGHT, 100),
        hit("10/8/2026 20:01:20.0000", &FAELAN, &DAILCRY, 100),
        died("10/8/2026 20:01:59.0000", &DAILCRY),
        "10/8/2026 20:02:00.0000  ENCOUNTER_END,2847,\"Captain Dailcry\",8,5,1,60000
"
        .to_string(),
        hit("10/8/2026 20:02:00.0050", &FAELAN, &KNIGHT, 100),
        hit("10/8/2026 20:02:05.0000", &DAILCRY, &FAELAN, 100),
        hit("10/8/2026 20:02:20.0000", &FAELAN, &KNIGHT, 100),
    ]
    .concat();
    let index = index_bytes(data.as_bytes());
    let pulls: Vec<_> = combat_pulls(&index.fights)
        .iter()
        .map(|pull| pull.start)
        .collect();
    assert_eq!(
        pulls,
        [ts("10/8/2026 20:02:20.0000")],
        "a living boss unit starts one only past a second after the boss pull, a dead one never"
    );
}

#[test]
fn a_dead_enemy_neither_opens_nor_holds_a_pull() {
    let data = [
        hit("10/8/2026 20:00:00.0000", &FAELAN, &KNIGHT, 100),
        died("10/8/2026 20:00:03.0000", &KNIGHT),
        hit("10/8/2026 20:00:03.5000", &KNIGHT, &FAELAN, 100),
        hit("10/8/2026 20:00:08.0000", &FAELAN, &FOOTMAN, 100),
        hit("10/8/2026 20:00:09.0000", &KNIGHT, &FAELAN, 100),
        died("10/8/2026 20:00:10.0000", &FOOTMAN),
    ]
    .concat();
    let index = index_bytes(data.as_bytes());
    let pulls: Vec<_> = index
        .fights
        .iter()
        .map(|fight| (fight.name.as_str(), fight.outcome, fight.start))
        .collect();
    assert_eq!(
        pulls,
        [
            (
                "Arathi Knight",
                Outcome::Kill,
                ts("10/8/2026 20:00:00.0000")
            ),
            (
                "Arathi Footman",
                Outcome::Kill,
                ts("10/8/2026 20:00:08.0000")
            ),
        ]
    );
    assert_eq!(
        index.fights[1].combat,
        Some(CombatPull { enemy_count: 1 }),
        "the knight of the earlier pull ticking into this one is no enemy of it"
    );

    let ticking = [
        hit("10/8/2026 20:00:00.0000", &FAELAN, &KNIGHT, 100),
        hit("10/8/2026 20:00:00.5000", &FAELAN, &FOOTMAN, 100),
        died("10/8/2026 20:00:01.0000", &KNIGHT),
        hit("10/8/2026 20:00:08.0000", &KNIGHT, &FAELAN, 100),
        hit("10/8/2026 20:00:16.0000", &KNIGHT, &FAELAN, 100),
        buff("10/8/2026 20:00:20.0000"),
    ]
    .concat();
    let index = index_bytes(ticking.as_bytes());
    assert_eq!(index.fights.len(), 1);
    assert_eq!(
        (index.fights[0].outcome, index.fights[0].end),
        (Outcome::Ended, ts("10/8/2026 20:00:00.5000")),
        "the dead knight's ticks do not keep the escaped footman's pull going"
    );
}

#[test]
fn only_a_player_of_ours_opens_a_pull() {
    let pet_alone = [
        hit("10/8/2026 20:00:00.0000", &KNIGHT, &WOLF, 100),
        hit("10/8/2026 20:00:05.0000", &WOLF, &KNIGHT, 100),
        buff("10/8/2026 20:00:20.0000"),
    ]
    .concat();
    assert!(index_bytes(pet_alone.as_bytes()).fights.is_empty());

    let pet_beside_us = [
        hit("10/8/2026 20:00:00.0000", &FAELAN, &KNIGHT, 100),
        hit("10/8/2026 20:00:01.0000", &WOLF, &FOOTMAN, 100),
        died("10/8/2026 20:00:02.0000", &KNIGHT),
        died("10/8/2026 20:00:03.0000", &FOOTMAN),
    ]
    .concat();
    let index = index_bytes(pet_beside_us.as_bytes());
    assert_eq!(index.fights.len(), 1);
    assert_eq!(
        (index.fights[0].outcome, index.fights[0].combat),
        (Outcome::Kill, Some(CombatPull { enemy_count: 2 })),
        "the pet's enemy belongs to the pull"
    );
}

#[test]
fn a_pull_is_named_after_the_enemy_that_took_the_most_damage() {
    let pull_of = |knight: u64, footman: u64| {
        let data = [
            hit("10/8/2026 20:00:00.0000", &FAELAN, &KNIGHT, knight),
            hit("10/8/2026 20:00:01.0000", &FAELAN, &FOOTMAN, footman),
            died("10/8/2026 20:00:02.0000", &KNIGHT),
            died("10/8/2026 20:00:03.0000", &FOOTMAN),
        ]
        .concat();
        let index = index_bytes(data.as_bytes());
        let pull = &index.fights[0];
        (pull.name.clone(), pull.combat)
    };
    let two = Some(CombatPull { enemy_count: 2 });
    assert_eq!(pull_of(100, 300), ("Arathi Footman".to_string(), two));
    assert_eq!(
        pull_of(100, 100),
        ("Arathi Knight".to_string(), two),
        "the first engaged wins a tie"
    );
}

#[test]
fn a_quiet_pull_ends_ten_seconds_after_the_last_exchange() {
    let first = hit("10/8/2026 20:00:00.0000", &FAELAN, &KNIGHT, 100);
    let quiet = [first.clone(), buff("10/8/2026 20:00:10.5000")].concat();
    let index = index_bytes(quiet.as_bytes());
    assert_eq!(index.fights.len(), 1);
    let pull = &index.fights[0];
    assert_eq!(
        (pull.outcome, pull.end, pull.duration_ms, pull.end_offset),
        (
            Outcome::Ended,
            ts("10/8/2026 20:00:00.0000"),
            0,
            first.len() as u64
        )
    );

    let mut indexer = Indexer::new();
    indexer.feed([first, buff("10/8/2026 20:00:09.5000")].concat().as_bytes());
    assert!(indexer.settled_index(None).fights.is_empty(), "still open");
    let index = indexer.finish();
    assert_eq!(index.fights.len(), 1);
    assert_eq!(index.fights[0].outcome, Outcome::Incomplete);
}

#[test]
fn a_quiet_pull_settles_once_a_line_comes_ten_seconds_later() {
    let mut indexer = Indexer::new();
    indexer.feed(hit("10/8/2026 20:00:00.0000", &FAELAN, &KNIGHT, 100).as_bytes());
    assert!(indexer.settled_index(Some(1000)).fights.is_empty());
    indexer.feed(buff("10/8/2026 20:00:10.5000").as_bytes());
    let settled = indexer.settled_index(Some(1000));
    assert_eq!(settled.fights.len(), 1);
    assert_eq!(settled.fights[0].outcome, Outcome::Ended);
}

#[test]
fn our_players_all_dead_is_a_wipe() {
    let data = [
        hit("10/8/2026 20:00:00.0000", &FAELAN, &KNIGHT, 100),
        hit("10/8/2026 20:00:01.0000", &PYRRIN, &KNIGHT, 100),
        hit("10/8/2026 20:00:02.0000", &KNIGHT, &FAELAN, 100),
        died("10/8/2026 20:00:04.0000", &FAELAN),
        hit("10/8/2026 20:00:05.0000", &KNIGHT, &PYRRIN, 100),
        died("10/8/2026 20:00:07.0000", &PYRRIN),
        hit("10/8/2026 20:00:08.0000", &STRANGER, &KNIGHT, 100),
    ]
    .concat();
    let index = index_bytes(data.as_bytes());
    assert_eq!(index.fights.len(), 1);
    let pull = &index.fights[0];
    assert_eq!(
        (pull.outcome, pull.end, pull.duration_ms),
        (Outcome::Wipe, ts("10/8/2026 20:00:07.0000"), 7_000)
    );
}

#[test]
fn encounter_start_closes_an_open_combat_pull() {
    let data = [
        hit("10/8/2026 20:00:00.0000", &FAELAN, &KNIGHT, 100),
        "10/8/2026 20:00:03.0000  ENCOUNTER_START,2847,\"Captain Dailcry\",8,5,2649\n".to_string(),
        hit("10/8/2026 20:00:10.0000", &FAELAN, &KNIGHT, 100),
        "10/8/2026 20:01:03.0000  ENCOUNTER_END,2847,\"Captain Dailcry\",8,5,1,60000\n".to_string(),
    ]
    .concat();
    let index = index_bytes(data.as_bytes());
    assert_eq!(index.fights.len(), 2);
    let (pull, boss) = (&index.fights[0], &index.fights[1]);
    assert_eq!(
        (pull.is_combat(), pull.outcome, pull.end),
        (true, Outcome::Ended, ts("10/8/2026 20:00:00.0000"))
    );
    assert_eq!(
        (
            boss.is_combat(),
            boss.index,
            boss.outcome,
            boss.duration_ms,
            boss.prelude_offset
        ),
        (false, 2, Outcome::Kill, 60_000, 0)
    );
}

#[test]
fn trash_in_a_run_keeps_the_run_result() {
    let end = "10/8/2026 20:10:00.0000  CHALLENGE_MODE_END";
    let trash = hit("10/8/2026 20:09:58.0000", &FAELAN, &KNIGHT, 100);
    let data = MYTHIC_PLUS.replacen(end, &format!("{trash}{end}"), 1);
    let index = index_bytes(data.as_bytes());
    let run = index.fights.iter().find(|fight| fight.is_run()).unwrap();
    assert_eq!(run.outcome, Outcome::Kill);
    let last = combat_pulls(&index.fights).pop().unwrap();
    assert_eq!(
        (
            last.start,
            last.outcome,
            last.run_index,
            last.difficulty,
            last.instance_id
        ),
        (
            ts("10/8/2026 20:09:58.0000"),
            Outcome::Ended,
            Some(run.index),
            8,
            2649
        )
    );
}

#[test]
fn combat_pulls_take_the_last_known_spec() {
    let data = [
        "10/7/2026 19:03:02.0762  ENCOUNTER_START,3492,\"Ula'tek\",15,23,3004\n",
        "10/7/2026 19:03:02.0762  COMBATANT_INFO,Player-4101-8E8C0182,1,100,200,300,400,0,0,0,0,10,10,10,0,92,1025,1025,1025,230,807,110,110,110,2726,62,[(90269,112121,1)],(0,0,0,0),[(249976,330,(),(7364,0),())],[Player-4101-77D4A765,1126,1],57,0,0,0\n",
        "10/7/2026 19:04:02.0762  ENCOUNTER_END,3492,\"Ula'tek\",15,23,0,60000\n",
        &hit("10/7/2026 19:05:00.0000", &FAELAN, &KNIGHT, 100),
        &hit("10/7/2026 19:05:01.0000", &KNIGHT, &PYRRIN, 100),
    ]
    .concat();
    let index = index_bytes(data.as_bytes());
    let pull = combat_pulls(&index.fights)[0];
    let specs: Vec<_> = pull
        .roster
        .iter()
        .map(|entry| (entry.guid.as_str(), entry.name.as_deref(), entry.spec_id))
        .collect();
    assert_eq!(
        specs,
        [
            (FAELAN.guid, Some(FAELAN.name), 62),
            (PYRRIN.guid, Some(PYRRIN.name), 0),
        ]
    );
}

#[test]
fn boss_pulls_are_unchanged() {
    let index = index_bytes(MINI_RAID.as_bytes());
    let offset_of = |prefix: &str| MINI_RAID.find(prefix).unwrap() as u64;
    let bosses: Vec<_> = index
        .fights
        .iter()
        .filter(|fight| !fight.is_combat())
        .map(|fight| {
            (
                fight.index,
                fight.outcome,
                fight.duration_ms,
                fight.boss_hp_percent.map(|hp| hp.round() as u32),
                fight.prelude_offset,
                fight.end_offset,
            )
        })
        .collect();
    assert_eq!(
        bosses,
        [
            (
                1,
                Outcome::Wipe,
                60_000,
                Some(75),
                offset_of("10/7/2026 19:02:50.0000"),
                offset_of("10/7/2026 19:10:00.0000")
            ),
            (
                2,
                Outcome::Wipe,
                19,
                None,
                offset_of("10/7/2026 19:10:00.0000"),
                offset_of("10/7/2026 19:20:00.0000")
            ),
            (
                3,
                Outcome::Incomplete,
                30_500,
                Some(50),
                offset_of("10/7/2026 19:20:00.0000"),
                MINI_RAID.len() as u64
            ),
        ]
    );
}
