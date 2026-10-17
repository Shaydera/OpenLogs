use std::collections::HashSet;
use std::fs;

use openlogs_gamedata::{
    BOSS_EFFECTS_DIR, CONSUMABLES_FILE, ConsumableKind, CooldownCategory, Curated, EffectAnchor,
    EffectCategory, EffectDuration, EffectKind, EffectTrigger, MAJOR_CDS_FILE, PHASES_DIR,
    PROCS_FILE, PhaseTrigger, PlayerCooldownKind, RAID_EFFECTS_FILE, RAID_FRAME_AURAS_FILE, class,
    spec,
};

fn boss_effects_json(encounter_id: u32, name: &str) -> String {
    format!(
        r#"{{ "version": 1, "encounter_id": {encounter_id}, "effects": [
            {{ "spell_ids": [7], "name": "{name}", "trigger": "aura_applied", "anchor": "follows_target",
               "radius_yd": 4.5, "duration": {{ "type": "until_aura_end" }},
               "evidence": {{ "aura_ids": [], "hit_ids": [8] }},
               "kind": "harmful", "category": "boss_mechanic" }} ] }}"#
    )
}

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
        // Shields (death recap) and tank buff rows are personal defensives as well.
        let may_be_defensive = matches!(
            entry.kind,
            PlayerCooldownKind::Shield | PlayerCooldownKind::Defensive
        );
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

#[test]
fn raid_frame_auras_load_and_an_override_replaces_them() {
    let bundled = Curated::bundled();
    assert_eq!(bundled.raid_frame_auras.version, 1);
    assert!(
        bundled.raid_frame_priority(33206).is_some(),
        "Pain Suppression"
    );

    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join(RAID_FRAME_AURAS_FILE),
        r#"{ "version": 1,
             "include": [ { "spell_id": 1, "name": "X", "priority": 0 } ],
             "exclude": [2] }"#,
    )
    .unwrap();

    let curated = Curated::load(Some(dir.path()));
    assert_eq!(curated.raid_frame_priority(1), Some(0));
    assert!(curated.raid_frame_excluded(2));
    assert_eq!(curated.raid_frame_priority(33206), None);
    assert!(curated.warnings.is_empty(), "{:?}", curated.warnings);
}

#[test]
fn effect_catalog_loads_with_defaults() {
    let bundled = Curated::bundled();
    assert!(!bundled.effects.is_empty());
    for effect in &bundled.effects {
        assert!(!effect.spell_ids.is_empty(), "{}", effect.name);
        assert!(effect.radius_yd > 0.0, "{}", effect.name);
    }

    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join(RAID_EFFECTS_FILE),
        r#"{ "version": 1, "effects": [
            { "spell_ids": [1], "name": "Shout", "trigger": "cast", "anchor": "caster_at_cast",
              "radius_yd": 100, "duration": { "type": "fixed", "ms": 5000 },
              "evidence": { "aura_ids": [1], "hit_ids": [] },
              "kind": "beneficial", "category": "raid_buff" },
            { "spell_ids": [2], "name": "Totem", "trigger": "summon", "anchor": "summoned_unit",
              "radius_yd": 10, "duration": { "type": "until_unit_gone" },
              "evidence": { "aura_ids": [], "hit_ids": [3], "tick_window_ms": 1000 },
              "kind": "beneficial", "category": "raid_cd" },
            { "spell_ids": [4], "name": "Mastery", "trigger": "aura_applied", "anchor": "follows_caster",
              "radius_yd": 40, "duration": { "type": "until_aura_end" },
              "evidence": { "aura_ids": [4], "hit_ids": [] },
              "kind": "beneficial", "category": "raid_cd" },
            { "spell_ids": [5], "name": "Burst", "trigger": "aura_applied", "anchor": "follows_target",
              "radius_yd": 3.5, "duration": { "type": "until_aura_end", "after_ms": 2500 },
              "evidence": { "aura_ids": [], "hit_ids": [6] },
              "kind": "harmful", "category": "boss_mechanic" } ] }"#,
    )
    .unwrap();
    let curated = Curated::load(Some(dir.path()));
    assert!(curated.warnings.is_empty(), "{:?}", curated.warnings);
    let [shout, totem, mastery, burst] = curated.effects.as_slice() else {
        panic!("{:?}", curated.effects);
    };
    assert_eq!(shout.trigger, EffectTrigger::Cast);
    assert_eq!(shout.anchor, EffectAnchor::CasterAtCast);
    assert_eq!(shout.duration, EffectDuration::Fixed { ms: 5000 });
    assert_eq!(shout.kind, EffectKind::Beneficial);
    assert_eq!(shout.category, EffectCategory::RaidBuff);
    assert_eq!(shout.evidence.tick_window_ms, 3000);
    assert_eq!(totem.duration, EffectDuration::UntilUnitGone);
    assert_eq!(totem.evidence.tick_window_ms, 1000);
    assert_eq!(
        mastery.duration,
        EffectDuration::UntilAuraEnd { after_ms: 0 }
    );
    assert_eq!(
        burst.duration,
        EffectDuration::UntilAuraEnd { after_ms: 2500 }
    );
}

#[test]
fn an_invalid_boss_effects_file_warns_and_is_ignored() {
    let dir = tempfile::tempdir().unwrap();
    let boss = dir.path().join(BOSS_EFFECTS_DIR);
    fs::create_dir(&boss).unwrap();
    fs::write(boss.join("3455.json"), boss_effects_json(3455, "Froth")).unwrap();
    fs::write(boss.join("3456.json"), "{ not json").unwrap();
    fs::write(boss.join("copy.json"), boss_effects_json(3455, "Copy")).unwrap();

    let curated = Curated::load(Some(dir.path()));
    assert_eq!(
        curated.warnings.len(),
        2,
        "the invalid file and the repeated encounter: {:?}",
        curated.warnings
    );
    let names: Vec<_> = curated
        .boss_effects
        .iter()
        .flat_map(|boss| boss.effects.iter().map(|e| e.name.as_str()))
        .collect();
    assert_eq!(names, ["Froth"]);
}

#[test]
fn effects_for_combines_raid_and_encounter_effects() {
    let dir = tempfile::tempdir().unwrap();
    let boss = dir.path().join(BOSS_EFFECTS_DIR);
    fs::create_dir(&boss).unwrap();
    fs::write(boss.join("3455.json"), boss_effects_json(3455, "Froth")).unwrap();
    fs::write(boss.join("3421.json"), boss_effects_json(3421, "Breaker")).unwrap();

    let curated = Curated::load(Some(dir.path()));
    let names = |encounter_id| -> Vec<String> {
        curated
            .effects_for(encounter_id)
            .map(|e| e.name.clone())
            .collect()
    };
    let raid: Vec<String> = curated.effects.iter().map(|e| e.name.clone()).collect();
    assert_eq!(names(3455), [raid.clone(), vec!["Froth".into()]].concat());
    assert_eq!(names(3497), raid);
}

#[test]
fn bundled_boss_effects_load_for_their_encounter() {
    let curated = Curated::bundled();
    let boss: Vec<_> = curated
        .effects_for(3455)
        .filter(|e| e.category == EffectCategory::BossMechanic)
        .map(|e| (e.name.as_str(), e.kind, e.radius_yd))
        .collect();
    assert_eq!(
        boss,
        [
            ("Plague Froth", EffectKind::Harmful, 4.5),
            ("Stygian Infection", EffectKind::Harmful, 3.5)
        ]
    );
}
