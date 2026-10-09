use std::collections::HashSet;
use std::fs;

use openlogs_gamedata::{
    CONSUMABLES_FILE, ConsumableKind, CooldownCategory, Curated, MAJOR_CDS_FILE, PHASES_DIR,
    PROCS_FILE, PhaseTrigger, PlayerCooldownKind, class, spec,
};

#[test]
fn override_files_replace_a_list_and_invalid_ones_fall_back_to_the_bundled_list() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join(CONSUMABLES_FILE),
        r#"{ "version": 2, "potion_cooldown_s": 300, "healthstone_cooldown_s": 60,
             "consumables": [ { "spell_id": 999, "name": "Test Potion", "kind": "combat_potion" } ],
             "name_patterns": [ { "contains": "Healthstone", "kind": "healthstone" } ] }"#,
    )
    .unwrap();
    fs::write(dir.path().join(PROCS_FILE), "{ not json").unwrap();

    let curated = Curated::load(Some(dir.path()));
    let bundled = Curated::bundled();
    assert_eq!(
        curated.consumable_kind(999, "Test Potion"),
        Some(ConsumableKind::CombatPotion)
    );
    assert_eq!(
        curated.consumable_kind(1, "Fel-Infused Healthstone"),
        Some(ConsumableKind::Healthstone),
        "unknown IDs fall back to the name patterns"
    );
    assert_eq!(curated.consumable_kind(2, "Arcane Barrage"), None);
    assert_eq!(curated.procs, bundled.procs);
    assert_eq!(
        curated.cooldowns, bundled.cooldowns,
        "lists without a file stay bundled"
    );
    assert_eq!(curated.warnings.len(), 1, "{:?}", curated.warnings);
    assert!(curated.warnings[0].contains(PROCS_FILE));
}

#[test]
fn spec_entries_win_over_class_wide_ones_of_the_casters_class() {
    let dir = tempfile::tempdir().unwrap();
    // Paladin (class 2): Retribution 70, Holy 65, Protection 66. Mage (class 8): Arcane 62.
    fs::write(
        dir.path().join(MAJOR_CDS_FILE),
        r#"{ "version": 1, "cooldowns": [
            { "spell_id": 10, "name": "Wings", "class_id": 2, "category": "raid_defensive", "duration_s": 20 },
            { "spell_id": 10, "name": "Wings", "class_id": 2, "specs": [70], "category": "offensive", "duration_s": 20 },
            { "spell_id": 20, "name": "Avenging Buff", "class_id": 2, "specs": [65], "category": "raid_defensive", "duration_s": 0 },
            { "spell_id": 21, "name": "Avenging Buff", "class_id": 2, "specs": [70], "category": "offensive", "duration_s": 0 } ] }"#,
    )
    .unwrap();
    let curated = Curated::load(Some(dir.path()));
    let category = |spell, spec_id| curated.cooldown(spell, spec_id).map(|c| c.category);
    assert_eq!(category(10, Some(70)), Some(CooldownCategory::Offensive));
    assert_eq!(
        category(10, Some(66)),
        Some(CooldownCategory::RaidDefensive)
    );
    assert_eq!(category(10, None), Some(CooldownCategory::RaidDefensive));
    assert_eq!(category(10, Some(62)), None, "another class");
    assert_eq!(category(20, Some(70)), None, "another spec");
    assert_eq!(
        curated
            .cooldown_named("Avenging Buff", Some(70))
            .map(|c| c.spell_id),
        Some(21),
        "a buff finds its cooldown by name"
    );
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

#[test]
fn bundled_lists_are_consistent() {
    let curated = Curated::bundled();
    let belongs_to_class = |name: &str, class_id: u32, specs: &[u32]| {
        assert!(class(class_id).is_some(), "{name}");
        for &spec_id in specs {
            assert_eq!(
                spec(spec_id).map(|s| s.class_id),
                Some(class_id),
                "{name} spec {spec_id}"
            );
        }
    };

    let mut seen = HashSet::new();
    for cd in &curated.cooldowns.cooldowns {
        belongs_to_class(&cd.name, cd.class_id, &cd.specs);
        assert!(
            seen.insert((cd.spell_id, cd.specs.clone())),
            "duplicate {}",
            cd.name
        );
    }
    for def in &curated.defensives.defensives {
        belongs_to_class(&def.name, def.class_id, &def.specs);
        assert!(def.cooldown_s > 0, "{}", def.name);
    }
    let mut seen = HashSet::new();
    for entry in &curated.player_cooldowns.spells {
        belongs_to_class(&entry.name, entry.class_id, &entry.specs);
        assert!(
            seen.insert((entry.spell_id, entry.specs.clone())),
            "duplicate {}",
            entry.name
        );
        assert!(
            curated
                .cooldowns
                .cooldowns
                .iter()
                .all(|c| c.spell_id != entry.spell_id),
            "{} is a major cooldown",
            entry.name
        );
        // Tank buff rows are personal defensives as well.
        let may_be_defensive = entry.kind == PlayerCooldownKind::Defensive;
        assert!(
            may_be_defensive
                || curated
                    .defensives
                    .defensives
                    .iter()
                    .all(|d| d.spell_id != entry.spell_id),
            "{} is a personal defensive",
            entry.name
        );
    }
}
