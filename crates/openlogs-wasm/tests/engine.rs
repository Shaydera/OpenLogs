use openlogs_gamedata::DungeonTable;
use openlogs_parser::Timestamp;
use openlogs_wasm::Engine;
use serde_json::{Value, json};

const FIXTURE: &str = include_str!("../../openlogs-index/tests/fixtures/mini_raid.txt");
/// A synthetic +12 in the real line format.
const MYTHIC_PLUS: &str = include_str!("../../openlogs-index/tests/fixtures/mythic_plus.txt");
const FAELAN: &str = "Faelan-Emberfall-EU";

fn whole_pull() -> Value {
    json!({ "startMs": null, "endMs": null, "attribution": "augmented" })
}

fn open(log: &str) -> (Engine, Value) {
    open_with(Engine::default(), log)
}

fn open_with(mut engine: Engine, log: &str) -> (Engine, Value) {
    engine.begin_index();
    for chunk in log.as_bytes().chunks(4096) {
        engine.index_feed(chunk);
    }
    let view = engine.finish_index("log-1", "WoWCombatLog-100726_185823.txt", log.len() as u64);
    (engine, serde_json::from_str(&view).unwrap())
}

fn load(engine: &mut Engine, log: &str, fight: u32) {
    let (start, end) = engine.fight_range(fight).unwrap();
    let part = &log.as_bytes()[start as usize..(end as usize).min(log.len())];
    engine.load_fight(part, start, fight).unwrap();
}

fn call(engine: &Engine, command: &str, args: Value) -> Value {
    serde_json::from_str(&engine.call(command, &args.to_string()).unwrap()).unwrap()
}

fn call_err(engine: &Engine, command: &str, args: Value) -> String {
    engine.call(command, &args.to_string()).unwrap_err()
}

fn assert_camel_case_keys(value: &Value, at: &str) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                assert!(!key.contains('_'), "{at}.{key}");
                assert_camel_case_keys(child, &format!("{at}.{key}"));
            }
        }
        Value::Array(items) => {
            for item in items {
                assert_camel_case_keys(item, at);
            }
        }
        _ => {}
    }
}

#[test]
fn opening_a_log_lists_its_pulls_and_a_stored_index_reopens_it() {
    let (engine, view) = open(FIXTURE);
    assert_eq!(view["cacheHit"], false);
    let first = &view["fights"][0];
    assert_eq!(
        (
            &first["index"],
            &first["name"],
            &first["outcome"],
            &first["difficultyLabel"],
            &first["playerCount"],
            &first["durationMs"],
        ),
        (
            &json!(1),
            &json!("Ula'tek"),
            &json!("wipe"),
            &json!("Heroic"),
            &json!(2),
            &json!(60_000)
        )
    );
    let start = Timestamp::parse("10/7/2026 19:03:02.0762").unwrap();
    assert_eq!(first["startUnixMs"], start.0 / 1000);
    assert_eq!(view["fights"][2]["outcome"], "incomplete");

    let mut reopened = Engine::default();
    let restored: Value = serde_json::from_str(
        &reopened
            .restore_index(
                &engine.index_json(),
                "log-1",
                "WoWCombatLog-100726_185823.txt",
                1,
            )
            .unwrap(),
    )
    .unwrap();
    assert_eq!(restored["cacheHit"], true);
    assert_eq!(restored["fights"], view["fights"]);
    load(&mut reopened, FIXTURE, 1);
    assert_eq!(
        call(
            &reopened,
            "damage_done_report",
            json!({ "fightIndex": 1, "filter": whole_pull() })
        )["total"],
        377_019_940
    );
}

#[test]
fn unusable_input_fails_with_a_message() {
    let (_, view) = open("shopping list\nmilk, eggs\n");
    assert_eq!(view["fights"], json!([]));
    assert!(view["warnings"].as_array().unwrap().iter().any(|w| {
        w.as_str()
            .unwrap()
            .contains("does not look like a WoW combat log")
    }));

    let (mut engine, _) = open(FIXTURE);
    assert_eq!(
        engine.fight_range(9).unwrap_err(),
        "Pull 9 does not exist in this log."
    );
    assert_eq!(
        call_err(
            &engine,
            "quick_overview",
            json!({ "fightIndex": 1, "filter": null })
        ),
        "Pull 1 is not loaded."
    );
    load(&mut engine, FIXTURE, 1);
    assert_eq!(
        call_err(
            &engine,
            "compare_pulls",
            json!({ "fightA": 1, "fightB": 9, "attribution": "augmented" })
        ),
        "Pull 9 does not exist in this log."
    );
    let not_a_player =
        json!({ "fightIndex": 1, "player": 0, "metric": "damage", "filter": whole_pull() });
    assert_eq!(
        call_err(&engine, "player_detail", not_a_player),
        "Actor 0 is not a player of this pull"
    );
    let nobody = json!({ "fightIndex": 1, "name": "Nobody", "filter": whole_pull() });
    assert_eq!(
        call_err(&engine, "target_detail", nobody),
        "No enemy named Nobody in this pull"
    );
}

#[test]
fn every_report_reaches_the_ui_with_camel_case_keys() {
    let (mut engine, _) = open(FIXTURE);
    load(&mut engine, FIXTURE, 1);
    load(&mut engine, FIXTURE, 3);
    let pull = |extra: Value| {
        let mut args = json!({ "fightIndex": 1, "filter": whole_pull() });
        args.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        args
    };

    let damage = call(&engine, "damage_done_report", pull(json!({})));
    assert_eq!(damage["total"], 377_019_940, "Faelan's two Arcane Barrages");
    let faelan = damage["players"][0]["player"].clone();
    let reattributed = json!({ "startMs": null, "endMs": null, "attribution": "reattributed" });
    let player = call(
        &engine,
        "player_detail",
        pull(json!({ "player": faelan, "metric": "damage", "filter": reattributed })),
    );
    assert_eq!(player["attribution"], "reattributed");
    let top_target = call(&engine, "target_detail", pull(json!({ "name": "" })));
    assert_eq!(
        top_target["name"], top_target["enemies"][0]["name"],
        "an empty name opens the most damaged enemy"
    );

    let scope = json!({ "perspective": "friendly", "source": [], "target": [], "ability": [] });
    let breakdown = call(
        &engine,
        "breakdown_report",
        pull(json!({ "scope": scope, "metric": "damageDone", "group": "source" })),
    );
    assert_eq!(breakdown["group"], "source");
    assert!(!breakdown["rows"].as_array().unwrap().is_empty());
    let options = call(
        &engine,
        "filter_options",
        pull(json!({ "scope": scope, "metric": "damageDone", "dimension": "ability" })),
    );
    let abilities = options.as_array().unwrap();
    assert!(!abilities.is_empty());
    assert!(abilities.iter().all(|o| o["value"]["kind"] == "ability"));

    let events = call(
        &engine,
        "events",
        pull(json!({
            "scope": scope,
            "metric": "damageDone",
            "options": { "beginCasts": true },
            "page": { "kind": "from", "offset": 0, "limit": 60 }
        })),
    );
    assert_eq!(events["total"], 2, "Faelan's two Arcane Barrages");
    assert_eq!(events["rows"][0]["event"], "SPELL_DAMAGE");
    let timeline = call(
        &engine,
        "timeline",
        pull(json!({
            "scope": scope,
            "metric": "casts",
            "lanes": "source",
            "window": { "startMs": 0, "endMs": 20000 }
        })),
    );
    assert_eq!(timeline["axis"], "source");
    let reports = [
        ("breakdown", breakdown),
        ("options", options),
        (
            "overview",
            call(
                &engine,
                "quick_overview",
                json!({ "fightIndex": 1, "filter": null }),
            ),
        ),
        ("damage", damage),
        ("healing", call(&engine, "healing_report", pull(json!({})))),
        (
            "taken",
            call(&engine, "damage_taken_report", pull(json!({}))),
        ),
        ("player", player),
        (
            "ability",
            call(
                &engine,
                "ability_detail",
                pull(json!({ "player": faelan, "spell": 44425, "pet": null, "metric": "damage" })),
            ),
        ),
        ("target", top_target),
        ("deaths", call(&engine, "deaths_report", pull(json!({})))),
        (
            "kills",
            call(
                &engine,
                "deaths_report",
                pull(json!({ "scope": { "perspective": "enemy" } })),
            ),
        ),
        (
            "casts",
            call(
                &engine,
                "casts_report",
                pull(json!({ "scope": scope, "group": "source", "hideProcs": true })),
            ),
        ),
        (
            "auras",
            call(
                &engine,
                "auras_report",
                pull(
                    json!({ "scope": { "perspective": "enemy" }, "kind": "debuffs", "group": "ability" }),
                ),
            ),
        ),
        (
            "interrupts",
            call(
                &engine,
                "interrupts_report",
                pull(json!({ "scope": scope, "group": "source" })),
            ),
        ),
        (
            "resources",
            call(&engine, "resources_report", pull(json!({}))),
        ),
        (
            "comparison",
            call(
                &engine,
                "compare_pulls",
                json!({ "fightA": 1, "fightB": 3, "attribution": "augmented" }),
            ),
        ),
        ("replay", call(&engine, "replay", pull(json!({})))),
        ("events", events),
        ("timeline", timeline),
    ];
    for (name, json) in reports {
        assert_camel_case_keys(&json, name);
    }
}

#[test]
fn a_range_overview_keeps_the_whole_pull_markers_and_names_their_players() {
    // Without COMBATANT_INFO Faelan has no spec, so only his death marker can add him.
    let log: String = FIXTURE
        .lines()
        .filter(|line| !line.contains("COMBATANT_INFO,Player-4101-8E8C0182"))
        .map(|line| format!("{line}\n"))
        .collect();
    let (mut engine, _) = open(&log);
    load(&mut engine, &log, 1);
    let first_second = json!({ "startMs": 0, "endMs": 1000, "attribution": "augmented" });
    let overview = call(
        &engine,
        "quick_overview",
        json!({ "fightIndex": 1, "filter": first_second }),
    );
    assert_eq!(overview["kpis"]["durationMs"], 1_000);
    assert_eq!(
        overview["timeline"]["durationMs"], 60_000,
        "the axis keeps the pull length"
    );
    assert_eq!(overview["deaths"], json!([]), "Faelan dies after the range");
    let markers = overview["timeline"]["markers"]["deaths"]
        .as_array()
        .unwrap();
    assert_eq!(markers.len(), 1);
    assert!(
        overview["players"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["actorId"] == markers[0]["player"] && p["name"] == FAELAN)
    );
}

#[test]
fn comparing_pulls_lists_every_player_of_either_pull_while_both_stay_loaded() {
    let (mut engine, _) = open(FIXTURE);
    load(&mut engine, FIXTURE, 1);
    load(&mut engine, FIXTURE, 3);
    let compare = json!({ "fightA": 1, "fightB": 3, "attribution": "augmented" });
    let comparison = call(&engine, "compare_pulls", compare.clone());
    assert_eq!(
        (
            &comparison["a"]["fightIndex"],
            &comparison["b"]["fightIndex"]
        ),
        (&json!(1), &json!(3))
    );
    assert_eq!(
        comparison["a"]["overview"]["deaths"]
            .as_array()
            .unwrap()
            .len(),
        1,
        "Faelan dies in the first pull"
    );

    let row = |name: &str| {
        comparison["players"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["player"]["name"] == name)
            .unwrap()
            .clone()
    };
    let faelan = row(FAELAN);
    assert!((faelan["a"]["dps"].as_f64().unwrap() - 377_019_940.0 / 60.0).abs() < 1e-6);
    assert_eq!(faelan["a"]["deaths"], 1);
    assert!(
        faelan["b"]["dps"].as_f64().unwrap() > 0.0,
        "Faelan hits Ula'tek in pull 3"
    );
    let pyrrin = row("Pyrrin-Emberfall-EU");
    assert!(pyrrin["a"].is_object() && pyrrin["b"].is_null() && pyrrin["dpsDelta"].is_null());

    assert!(engine.touch_fight(1));
    load(&mut engine, FIXTURE, 2);
    assert_eq!(
        call_err(&engine, "compare_pulls", compare),
        "Pull 3 is not loaded.",
        "only the two most recently used pulls stay loaded"
    );
    assert!(!engine.touch_fight(3));
}

#[test]
fn opening_a_mythic_plus_log_lists_the_run_and_its_boss_pulls() {
    let (_, view) = open(MYTHIC_PLUS);
    let rows: Vec<_> = view["fights"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| {
            (
                f["index"].clone(),
                f["name"].clone(),
                f["outcome"].clone(),
                f["runIndex"].clone(),
            )
        })
        .collect();
    assert_eq!(
        rows,
        [
            (
                json!(1),
                json!("Priory of the Sacred Flame"),
                json!("kill"),
                Value::Null
            ),
            (json!(2), json!("Captain Dailcry"), json!("kill"), json!(1)),
            (json!(3), json!("Baron Braunpyke"), json!("wipe"), json!(1)),
            (json!(4), json!("Baron Braunpyke"), json!("kill"), json!(1)),
        ]
    );
    let run = &view["fights"][0];
    assert_eq!(
        run["run"],
        json!({
            "challengeModeId": 499,
            "keystoneLevel": 12,
            "affixIds": [10, 147, 9],
            "totalTimeMs": 600_000,
            "bosses": null,
            "timer": null,
        })
    );
    assert_eq!(
        (
            &run["durationMs"],
            &run["playerCount"],
            &run["bossHpPercent"]
        ),
        (&json!(600_000), &json!(2), &Value::Null)
    );
    assert_eq!(view["fights"][1]["run"], Value::Null);
    assert_eq!(view["fights"][1]["difficultyLabel"], "Mythic+");
    assert_eq!(view["zone"], "Priory of the Sacred Flame");
}

/// Priory: three bosses, 1950/1560/1170 s.
fn with_dungeons() -> Engine {
    let table = DungeonTable::from_csv(
        include_bytes!("../../openlogs-gamedata/tests/fixtures/MapChallengeMode.csv"),
        include_bytes!("../../openlogs-gamedata/tests/fixtures/DungeonEncounter.csv"),
    )
    .unwrap();
    let mut engine = Engine::default();
    engine.set_dungeons(&table.to_json()).unwrap();
    engine
}

/// `MYTHIC_PLUS` with Prioress Murrpray killed before the run's end, which logs `total_ms`.
fn every_boss_killed(total_ms: u64) -> String {
    MYTHIC_PLUS
        .lines()
        .flat_map(|line| {
            if line.contains("CHALLENGE_MODE_END") {
                vec![
                    "10/8/2026 20:09:00.0000  ENCOUNTER_START,2848,\"Prioress Murrpray\",8,5,2649"
                        .to_string(),
                    "10/8/2026 20:09:50.0000  ENCOUNTER_END,2848,\"Prioress Murrpray\",8,5,1,50000"
                        .to_string(),
                    format!("10/8/2026 20:10:00.0000  CHALLENGE_MODE_END,2649,1,12,{total_ms}"),
                ]
            } else {
                vec![line.to_string()]
            }
        })
        .map(|line| line + "\n")
        .collect()
}

#[test]
fn dungeon_data_decides_the_result_of_a_run() {
    let (_, view) = open_with(with_dungeons(), MYTHIC_PLUS);
    let run = &view["fights"][0];
    assert_eq!(run["outcome"], "wipe", "Prioress Murrpray lives");
    assert_eq!(run["run"]["bosses"], json!({ "killed": 2, "total": 3 }));
    assert_eq!(run["run"]["timer"], Value::Null);
    let outcomes: Vec<_> = view["fights"].as_array().unwrap()[1..]
        .iter()
        .map(|f| f["outcome"].clone())
        .collect();
    assert_eq!(
        outcomes,
        [json!("kill"), json!("wipe"), json!("kill")],
        "boss pulls keep their outcome"
    );

    for (total_ms, timer) in [
        (600_000, json!({ "kind": "inTime", "upgrades": 3 })),
        (2_000_000, json!({ "kind": "overTime" })),
    ] {
        let (_, view) = open_with(with_dungeons(), &every_boss_killed(total_ms));
        assert_eq!(view["fights"][0]["outcome"], "kill");
        assert_eq!(
            view["fights"][0]["run"]["bosses"],
            json!({ "killed": 3, "total": 3 })
        );
        assert_eq!(view["fights"][0]["run"]["timer"], timer, "{total_ms} ms");
    }
}

#[test]
fn a_run_opens_like_a_pull_with_boss_phases_and_no_boss_hp() {
    let (mut engine, _) = open(MYTHIC_PLUS);
    load(&mut engine, MYTHIC_PLUS, 1);
    let run = call(
        &engine,
        "quick_overview",
        json!({ "fightIndex": 1, "filter": null }),
    );
    let kpis = &run["kpis"];
    assert_eq!(
        (&kpis["players"], &kpis["durationMs"], &kpis["deaths"]),
        (&json!(2), &json!(600_000), &json!(1))
    );
    assert!(
        run["timeline"]["bossHp"]
            .as_array()
            .unwrap()
            .iter()
            .all(Value::is_null)
    );
    assert_eq!(run["timeline"]["markers"]["bossCasts"], json!([]));
    let phases = run["timeline"]["phases"].as_array().unwrap();
    assert_eq!(phases.len(), 7);
    assert_eq!(
        phases[0],
        json!({ "kind": "trash", "number": 1, "startMs": 0, "endMs": 60_000, "name": null })
    );
    assert_eq!(
        (&phases[1]["kind"], &phases[1]["name"]),
        (&json!("boss"), &json!("Captain Dailcry"))
    );

    let damage = |filter: Value| {
        call(
            &engine,
            "damage_done_report",
            json!({ "fightIndex": 1, "filter": filter }),
        )["total"]
            .clone()
    };
    assert_eq!(
        damage(whole_pull()),
        610_000_000,
        "trash and boss damage of the whole run"
    );
    let second_baron = json!({ "startMs": 360000, "endMs": 420000, "attribution": "augmented" });
    assert_eq!(damage(second_baron), 400_000_000);

    load(&mut engine, MYTHIC_PLUS, 2);
    let pull = call(
        &engine,
        "quick_overview",
        json!({ "fightIndex": 2, "filter": null }),
    );
    assert!(
        pull["timeline"]["bossHp"]
            .as_array()
            .unwrap()
            .iter()
            .any(|hp| !hp.is_null()),
        "a boss pull of the run keeps its boss HP"
    );
}
