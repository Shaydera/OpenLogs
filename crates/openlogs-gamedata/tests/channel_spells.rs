use openlogs_gamedata::{ChannelSpellError, ChannelSpells};

const SPELL_MISC: &str = "ID,Attributes_0,Attributes_1,DifficultyID,SpellID\n\
1,0,872432772,0,5143\n\
2,0,0,0,7268\n\
3,0,0,0,1242173\n\
4,0,1088,0,12051\n\
5,0,4,14,9000\n\
6,0,0,0,9000\n\
7,0,4,14,9001\n\
8,0,-2147483644,0,9002\n";

fn table() -> ChannelSpells {
    ChannelSpells::from_csv(SPELL_MISC.as_bytes()).unwrap()
}

#[test]
fn reads_channelled_and_self_channelled_spells_from_their_attributes() {
    let table = table();
    assert!(table.contains(5143), "Arcane Missiles: channelled");
    assert!(table.contains(12051), "Evocation: self-channelled only");
    assert!(!table.contains(7268), "the missiles' hits are no channel");
    assert!(!table.contains(1242173), "Void Volley is an instant");
    assert!(!table.contains(9000), "the default difficulty wins");
    assert!(
        table.contains(9001),
        "another difficulty counts without a default row"
    );
    assert!(table.contains(9002), "a signed value keeps its bits");
    assert_eq!(table.len(), 4);
}

#[test]
fn the_web_table_lists_the_ids_in_order_as_differences_and_reads_back() {
    let json = table().to_json();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&json).unwrap(),
        serde_json::json!({ "ids": [5143, 3858, 1, 3049] })
    );
    assert_eq!(ChannelSpells::from_json(&json).unwrap(), table());
    assert!(matches!(
        ChannelSpells::from_csv(b"ID,DifficultyID,SpellID\n1,0,5\n"),
        Err(ChannelSpellError::MissingColumn("Attributes_1"))
    ));
}
