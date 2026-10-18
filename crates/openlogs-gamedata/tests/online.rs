//! Hits the real services. `cargo test -p openlogs-gamedata --test online -- --ignored`

use openlogs_gamedata::{
    HttpFetch, download_boss_portraits, download_dungeons, download_map_art,
    download_spell_classes, download_spell_tables,
};

#[test]
#[ignore = "needs network access to wago.tools"]
fn wago_tools_provides_every_table() {
    let fetch = HttpFetch::for_bulk_data();
    let spells = download_spell_tables(&fetch).unwrap();
    assert!(
        spells.icons.len() > 100_000,
        "got {} spells",
        spells.icons.len()
    );
    assert!(
        spells.icons.icon(44425).is_some(),
        "Arcane Barrage has an icon"
    );
    assert!(
        spells.channels.contains(5143),
        "Arcane Missiles is channelled"
    );
    let classes = download_spell_classes(&fetch).unwrap();
    assert!(
        classes.class_spell_count() > 10_000,
        "got {} class spells",
        classes.class_spell_count()
    );
    assert!(classes.is_class_spell(133), "Fireball is a class spell");
    for (spell, name) in [
        (408, "Kidney Shot"),
        (118, "Polymorph"),
        (853, "Hammer of Justice"),
        (119381, "Leg Sweep"),
        (118699, "Fear"),
    ] {
        assert!(classes.is_crowd_control(spell), "{name} is crowd control");
    }
    assert!(
        !classes.is_crowd_control(133),
        "Fireball is no crowd control"
    );
    let dungeons = download_dungeons(&fetch).unwrap();
    assert!(dungeons.len() > 80, "got {} keys", dungeons.len());
    let portraits = download_boss_portraits(&fetch).unwrap();
    assert!(portraits.len() > 1_000, "got {} portraits", portraits.len());
    assert!(portraits.portrait(3492).is_some(), "Ula'tek has a portrait");
    let map_art = download_map_art(&fetch).unwrap();
    assert!(
        map_art.maps.len() > 1_000,
        "got {} maps",
        map_art.maps.len()
    );
    let vile_crypt = map_art.maps[&2608];
    assert_eq!(
        (vile_crypt.zone, vile_crypt.floor, vile_crypt.raid),
        (16915, Some(2), true)
    );
    let sszorak_room = map_art.maps[&2609];
    assert_eq!((sszorak_room.zone, sszorak_room.floor), (16915, Some(3)));
    assert_eq!(map_art.pins[&3420].ui_map_id, 2609, "Sszorak has a pin");
}
