use std::fs;

use openlogs_gamedata::{Curated, PHASE_NAMES_FILE, PHASES_DIR, PhaseTrigger};

#[test]
fn override_files_replace_a_list_and_invalid_ones_fall_back_to_the_bundled_list() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join(PHASE_NAMES_FILE),
        r#"{ "version": 2, "encounters": [ { "encounter_id": 3492, "intermission": "Boss submerged" } ] }"#,
    )
    .unwrap();
    let curated = Curated::load(Some(dir.path()));
    assert_eq!(curated.intermission_name(3492), Some("Boss submerged"));
    assert!(curated.warnings.is_empty(), "{:?}", curated.warnings);

    fs::write(dir.path().join(PHASE_NAMES_FILE), "{ not json").unwrap();
    let curated = Curated::load(Some(dir.path()));
    assert_eq!(curated.phase_names, Curated::bundled().phase_names);
    assert_eq!(curated.warnings.len(), 1, "{:?}", curated.warnings);
    assert!(curated.warnings[0].contains(PHASE_NAMES_FILE));
}

#[test]
fn phase_configs_load_from_the_override_folder() {
    let dir = tempfile::tempdir().unwrap();
    let phases = dir.path().join(PHASES_DIR);
    fs::create_dir(&phases).unwrap();
    fs::write(
        phases.join("3492.JSON"),
        r#"{ "version": 1, "encounter_id": 3492, "phases": [
            { "name": "P1", "start": { "type": "pull" } },
            { "name": "Adds", "start": { "type": "unit_appears", "name": "Blightscale Rawling" } },
            { "name": "Burn", "start": { "type": "boss_hp_below", "percent": 30 } },
            { "name": "Spit", "start": { "type": "cast", "spell_id": 5 } } ] }"#,
    )
    .unwrap();
    fs::write(phases.join("3493.json"), "{ not json").unwrap();
    fs::write(
        phases.join("copy.json"),
        r#"{ "version": 1, "encounter_id": 3492, "phases": [] }"#,
    )
    .unwrap();
    fs::write(phases.join("notes.txt"), "ignored").unwrap();

    let curated = Curated::load(Some(dir.path()));
    let config = curated.phase_config(3492).unwrap();
    let starts: Vec<_> = config.phases.iter().map(|p| p.start.clone()).collect();
    assert_eq!(
        starts,
        [
            PhaseTrigger::Pull,
            PhaseTrigger::UnitAppears {
                name: "Blightscale Rawling".into()
            },
            PhaseTrigger::BossHpBelow { percent: 30 },
            PhaseTrigger::Cast { spell_id: 5 },
        ]
    );
    assert_eq!(
        curated.warnings.len(),
        2,
        "the invalid file and the repeated encounter: {:?}",
        curated.warnings
    );
    assert!(Curated::bundled().phase_config(3492).is_none());
}
