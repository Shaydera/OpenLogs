//! Class and crowd-control spells from trimmed real wago.tools exports.

use openlogs_gamedata::{SpellClasses, SpellClassesError};

const SPELL_CLASS_OPTIONS: &[u8] = include_bytes!("fixtures/SpellClassOptions.csv");
const SPELL_EFFECT: &[u8] = include_bytes!("fixtures/SpellEffect.csv");

const POLYMORPH: u32 = 118;
const FIREBALL: u32 = 133;
const KIDNEY_SHOT: u32 = 408;
const HEALING_POTION: u32 = 441;
const WAR_STOMP: u32 = 20549;

fn table() -> SpellClasses {
    SpellClasses::from_csv(SPELL_CLASS_OPTIONS, SPELL_EFFECT).unwrap()
}

#[test]
fn class_spells_come_from_class_spell_families() {
    let table = table();
    assert!(table.is_class_spell(FIREBALL), "mage family");
    assert!(table.is_class_spell(KIDNEY_SHOT), "rogue family");
    assert!(!table.is_class_spell(HEALING_POTION), "potion family");
    assert!(!table.is_class_spell(WAR_STOMP), "a racial has no family");
}

#[test]
fn a_class_stun_is_crowd_control_and_a_damage_spell_is_not() {
    let table = table();
    assert!(table.is_crowd_control(KIDNEY_SHOT), "stun");
    assert!(table.is_crowd_control(POLYMORPH), "confuse");
    assert!(!table.is_crowd_control(FIREBALL));
    assert!(
        !table.is_crowd_control(WAR_STOMP),
        "a stun outside the class families"
    );
}

#[test]
fn an_html_page_fails_with_a_missing_column() {
    assert!(matches!(
        SpellClasses::from_csv(b"<!DOCTYPE html>\n", SPELL_EFFECT),
        Err(SpellClassesError::MissingColumn("SpellClassSet"))
    ));
    assert!(matches!(
        SpellClasses::from_csv(SPELL_CLASS_OPTIONS, b"<!DOCTYPE html>\n"),
        Err(SpellClassesError::MissingColumn("EffectAura"))
    ));
}

#[test]
fn a_header_only_export_fails_as_empty() {
    assert!(matches!(
        SpellClasses::from_csv(b"ID,SpellID,SpellClassSet\n", SPELL_EFFECT),
        Err(SpellClassesError::Empty)
    ));
}

#[test]
fn round_trips_through_json() {
    let json = table().to_json();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&json).unwrap(),
        serde_json::json!({ "classSpells": [118, 15, 275], "crowdControl": [118, 290] })
    );
    let read = SpellClasses::from_json(&json).unwrap();
    assert_eq!(read, table());
    assert!(read.is_loaded());
    assert!(!SpellClasses::default().is_loaded());
}

#[test]
fn a_truncated_json_export_fails_as_empty() {
    assert!(matches!(
        SpellClasses::from_json(r#"{"classSpells":[],"crowdControl":[]}"#),
        Err(SpellClassesError::Empty)
    ));
}
