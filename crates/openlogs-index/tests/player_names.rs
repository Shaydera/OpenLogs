use openlogs_index::GameFlavor;

#[test]
fn a_forever_player_name_is_everything_before_realm_and_region() {
    let forever = Some(GameFlavor::Forever);
    assert_eq!(
        GameFlavor::player_name(forever, "Ravel-Ashwood-Normal-EU"),
        "Ravel Ashwood"
    );
    assert_eq!(
        GameFlavor::player_name(forever, "Rexxar-Normal-EU"),
        "Rexxar"
    );
    assert_eq!(GameFlavor::player_name(forever, "Wolf"), "Wolf");
}

#[test]
fn a_retail_player_name_is_its_first_part() {
    for flavor in [Some(GameFlavor::Retail), None] {
        assert_eq!(
            GameFlavor::player_name(flavor, "Faelan-Emberfall-EU"),
            "Faelan"
        );
    }
}
