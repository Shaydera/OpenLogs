//! Boss portraits from trimmed real wago.tools exports.

use openlogs_gamedata::{BossPortraitError, BossPortraitTable};

const JOURNAL_ENCOUNTER: &[u8] = include_bytes!("fixtures/JournalEncounter.csv");
const JOURNAL_ENCOUNTER_CREATURE: &[u8] = include_bytes!("fixtures/JournalEncounterCreature.csv");
const MANIFEST: &[u8] = include_bytes!("fixtures/ManifestInterfaceData.csv");

fn table() -> BossPortraitTable {
    BossPortraitTable::from_csv(JOURNAL_ENCOUNTER, JOURNAL_ENCOUNTER_CREATURE, MANIFEST).unwrap()
}

#[test]
fn an_encounter_gets_the_portrait_of_its_first_journal_creature() {
    let table = table();
    assert_eq!(table.portrait(3492), Some("ui-ej-boss-ulatek"));
    // "Blood of Ula'tek" (OrderIndex 1, no file) comes first in the export; "Breath" (0) wins.
    assert_eq!(table.portrait(3445), Some("ui-ej-boss-golems"));
    assert_eq!(
        table.len(),
        3,
        "General Umbriss has no DungeonEncounterID and no journal portrait file"
    );

    let encounters = b"ID,DungeonEncounterID\n9001,4001\n20,4002\n10,4002\n";
    let creatures = b"ID,JournalEncounterID,FileDataID,OrderIndex\n\
        1,9001,521744,0\n2,20,7966630,0\n3,10,7966634,0\n";
    let synthetic = BossPortraitTable::from_csv(encounters, creatures, MANIFEST).unwrap();
    assert_eq!(
        synthetic.portrait(4001),
        None,
        "the default silhouette is no portrait"
    );
    assert_eq!(
        synthetic.portrait(4002),
        Some("ui-ej-boss-ulatek"),
        "the lowest journal ID wins"
    );
}

#[test]
fn the_web_table_maps_encounters_to_portraits_and_unusable_exports_fail() {
    assert_eq!(
        table().to_json(),
        r#"{"3379":"ui-ej-boss-nagasorcerer","3445":"ui-ej-boss-golems","3492":"ui-ej-boss-ulatek"}"#
    );
    assert!(matches!(
        BossPortraitTable::from_csv(b"<!DOCTYPE html>\n", JOURNAL_ENCOUNTER_CREATURE, MANIFEST),
        Err(BossPortraitError::MissingColumn("ID"))
    ));
    assert!(matches!(
        BossPortraitTable::from_csv(
            b"ID,DungeonEncounterID\n",
            b"ID,JournalEncounterID,FileDataID,OrderIndex\n",
            MANIFEST
        ),
        Err(BossPortraitError::Empty)
    ));
}
