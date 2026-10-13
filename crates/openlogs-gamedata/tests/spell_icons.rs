use openlogs_gamedata::{SpellIconError, SpellIconTable, is_valid_icon_name};

const MANIFEST: &str = "ID,FilePath,FileName\n\
236205,Interface\\ICONS\\,Ability_Mage_ArcaneBarrage.blp\n\
538745,Interface\\ICONS\\,Warlock_ Healthstone.blp\n\
130646,Interface\\AbilitiesFrame\\,UI-AbilityPanel-BotLeft.blp\n\
111,Interface\\ICONS\\,Spell_Heroic.blp\n\
222,Interface\\ICONS\\,Spell_Normal.blp\n";

const SPELL_MISC: &str = "ID,DifficultyID,SpellIconFileDataID,SpellID\n\
1,0,236205,44425\n\
2,0,538745,6262\n\
3,0,8026696,114051\n\
4,0,130646,99\n\
5,14,111,5\n\
6,0,222,5\n\
7,0,0,7\n";

fn table() -> SpellIconTable {
    SpellIconTable::from_csv(SPELL_MISC.as_bytes(), MANIFEST.as_bytes()).unwrap()
}

#[test]
fn maps_spells_to_zamimg_names_through_the_manifest() {
    let table = table();
    assert_eq!(table.icon(44425), Some("ability_mage_arcanebarrage"));
    assert_eq!(table.icon(6262), Some("warlock_-healthstone"));
    assert_eq!(
        table.icon(114051),
        Some("8026696"),
        "a file without a manifest entry keeps its numeric name"
    );
    assert_eq!(table.icon(99), Some("130646"), "only ICONS paths are icons");
    assert_eq!(
        table.icon(5),
        Some("spell_normal"),
        "the default difficulty wins"
    );
    assert_eq!(table.icon(7), None, "file ID 0 is no icon");
}

#[test]
fn the_web_table_lists_spells_in_order_and_names_each_icon_once() {
    let spell_misc = format!("{SPELL_MISC}8,0,236205,44426\n");
    let table = SpellIconTable::from_csv(spell_misc.as_bytes(), MANIFEST.as_bytes()).unwrap();
    let json: serde_json::Value = serde_json::from_str(&table.to_json()).unwrap();
    assert_eq!(
        json,
        serde_json::json!({
            "names": ["spell_normal", "130646", "warlock_-healthstone", "ability_mage_arcanebarrage", "8026696"],
            "ids": [5, 94, 6163, 38163, 1, 69625],
            "icons": [0, 1, 2, 3, 3, 4],
        })
    );
    assert!(matches!(
        SpellIconTable::from_csv(b"ID,DifficultyID,SpellID\n1,0,5\n", MANIFEST.as_bytes()),
        Err(SpellIconError::MissingColumn("SpellIconFileDataID"))
    ));
}

#[test]
fn icon_names_are_safe_as_file_names_and_url_segments() {
    for ok in ["warlock_-healthstone", "8026696", "console", "com10"] {
        assert!(is_valid_icon_name(ok), "{ok}");
    }
    let long = "a".repeat(129);
    for bad in [
        "",
        "../secret",
        "a/b",
        "a\\b",
        "ICON",
        "icon.jpg",
        "spell name",
        long.as_str(),
        "con",
        "nul",
        "com1",
        "lpt9",
    ] {
        assert!(!is_valid_icon_name(bad), "{bad:?}");
    }
}
