//! The replay's map art index from trimmed real wago.tools exports.

use openlogs_gamedata::{BossPin, MapArtError, MapArtTable};

const UI_MAP_ASSIGNMENT: &[u8] = include_bytes!("fixtures/UiMapAssignment.csv");
const UI_MAP_GROUP_MEMBER: &[u8] = include_bytes!("fixtures/UiMapGroupMember.csv");
const AREA_TABLE: &[u8] = include_bytes!("fixtures/AreaTable.csv");
const MAP: &[u8] = include_bytes!("fixtures/Map.csv");
const JOURNAL_ENCOUNTER: &[u8] = include_bytes!("fixtures/JournalEncounter.csv");

fn table() -> MapArtTable {
    MapArtTable::from_csv(
        UI_MAP_ASSIGNMENT,
        UI_MAP_GROUP_MEMBER,
        AREA_TABLE,
        MAP,
        JOURNAL_ENCOUNTER,
    )
    .unwrap()
}

#[test]
fn raid_floors_map_to_their_wowhead_zone_and_floor() {
    let table = table();
    for (ui_map, floor) in [(2606, 0), (2607, 1), (2608, 2), (2609, 3), (2610, 4)] {
        let map = table.maps[&ui_map];
        assert_eq!(
            (map.zone, map.floor, map.raid),
            (16915, Some(floor), true),
            "uiMap {ui_map}"
        );
    }
    let vile_crypt = table.maps[&2608];
    assert_eq!(
        (
            vile_crypt.min_x,
            vile_crypt.max_x,
            vile_crypt.min_y,
            vile_crypt.max_y
        ),
        (265.0, 885.0, -802.5, 127.5)
    );
}

#[test]
fn a_dungeon_map_is_not_a_raid() {
    let stonevault = table().maps[&2341];
    assert_eq!((stonevault.zone, stonevault.raid), (14883, false));
}

#[test]
fn a_map_without_a_group_has_no_floor() {
    assert_eq!(table().maps[&2341].floor, None);
}

#[test]
fn a_map_without_one_top_level_area_is_left_out() {
    let areas = b"ID,ContinentID,ParentAreaID\n14883,2652,0\n16915,3004,0\n16916,3004,0\n";
    let table = MapArtTable::from_csv(
        UI_MAP_ASSIGNMENT,
        UI_MAP_GROUP_MEMBER,
        areas,
        MAP,
        JOURNAL_ENCOUNTER,
    )
    .unwrap();
    assert_eq!(table.maps.keys().copied().collect::<Vec<_>>(), [2341]);
}

#[test]
fn a_boss_pin_comes_from_the_journal() {
    let table = table();
    let sszorak = table.pins[&3420];
    assert_eq!(sszorak.ui_map_id, 2609);
    assert!((sszorak.u - 0.546).abs() < 1e-3, "u {}", sszorak.u);
    assert!((sszorak.v - 0.724).abs() < 1e-3, "v {}", sszorak.v);
    assert_eq!(
        table.pins.keys().copied().collect::<Vec<_>>(),
        [3379, 3420, 3445, 3492],
        "General Umbriss has no DungeonEncounterID"
    );

    let journal = b"ID,DungeonEncounterID,UiMapID,Map_0,Map_1\n\
        20,4002,2608,0.2,0.2\n10,4002,2609,0.1,0.3\n";
    let synthetic = MapArtTable::from_csv(
        UI_MAP_ASSIGNMENT,
        UI_MAP_GROUP_MEMBER,
        AREA_TABLE,
        MAP,
        journal,
    )
    .unwrap();
    assert_eq!(
        synthetic.pins[&4002],
        BossPin {
            ui_map_id: 2609,
            u: 0.1,
            v: 0.3
        },
        "the lowest journal ID wins"
    );
}

#[test]
fn the_web_table_keeps_every_entry() {
    let table = table();
    let json = table.to_json();
    assert!(
        json.contains(
            r#""2608":{"zone":16915,"floor":2,"raid":true,"minX":265.0,"maxX":885.0,"minY":-802.5,"maxY":127.5}"#
        ),
        "{json}"
    );
    assert!(json.contains(r#""3420":{"uiMapId":2609,"#), "{json}");
    assert_eq!(MapArtTable::from_json(&json).unwrap(), table);
}

#[test]
fn an_html_page_fails_with_a_missing_column() {
    assert!(matches!(
        MapArtTable::from_csv(
            b"<!DOCTYPE html>\n",
            UI_MAP_GROUP_MEMBER,
            AREA_TABLE,
            MAP,
            JOURNAL_ENCOUNTER
        ),
        Err(MapArtError::MissingColumn("UiMapID"))
    ));
    assert!(matches!(
        MapArtTable::from_csv(
            UI_MAP_ASSIGNMENT,
            UI_MAP_GROUP_MEMBER,
            AREA_TABLE,
            MAP,
            b"<!DOCTYPE html>\n"
        ),
        Err(MapArtError::MissingColumn("ID"))
    ));
}

#[test]
fn a_header_only_export_fails_as_empty() {
    assert!(matches!(
        MapArtTable::from_csv(
            b"Region_0,Region_1,Region_3,Region_4,ID,UiMapID,OrderIndex,MapID\n",
            UI_MAP_GROUP_MEMBER,
            AREA_TABLE,
            MAP,
            JOURNAL_ENCOUNTER
        ),
        Err(MapArtError::Empty)
    ));
}
