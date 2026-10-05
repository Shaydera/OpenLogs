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
fn the_table_round_trips_through_tsv_and_rejects_unusable_input() {
    let table = table();
    let text = table.to_tsv();
    assert_eq!(
        text,
        "3379\tui-ej-boss-nagasorcerer\n3445\tui-ej-boss-golems\n3492\tui-ej-boss-ulatek\n"
    );
    assert_eq!(
        BossPortraitTable::from_tsv(&format!("# comment\n\n{text}")).unwrap(),
        table
    );
    assert!(matches!(
        BossPortraitTable::from_tsv("3492\tUI-EJ\n"),
        Err(BossPortraitError::Malformed(1))
    ));
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
