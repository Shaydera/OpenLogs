use openlogs_parser::{ParseError, split_fields, split_line};

#[test]
fn split_line_separates_timestamp_and_body_at_the_double_space() {
    assert_eq!(
        split_line(r#"10/7/2026 19:03:02.0762  ENCOUNTER_START,3492,"Ula'tek",15,23,3004"#),
        Ok((
            "10/7/2026 19:03:02.0762",
            r#"ENCOUNTER_START,3492,"Ula'tek",15,23,3004"#
        ))
    );
    assert_eq!(
        split_line("ENCOUNTER_START,1"),
        Err(ParseError::MissingSeparator)
    );
}

#[test]
fn split_fields_respects_quotes_and_brackets() {
    for (body, expected) in [
        (
            r#"ENCHANT_APPLIED,"Oil, Tier 2",268211"#,
            &["ENCHANT_APPLIED", "Oil, Tier 2", "268211"][..],
        ),
        (
            "COMBATANT_INFO,Player-1,[(1,2,1),(3,4,1)],(0,0,0,0),[],57",
            &[
                "COMBATANT_INFO",
                "Player-1",
                "[(1,2,1),(3,4,1)]",
                "(0,0,0,0)",
                "[]",
                "57",
            ],
        ),
        ("A,,B,", &["A", "", "B", ""]),
        (
            r#"X,"Årvel-Emberfall-EU","Paëne-Duskmere-EU""#,
            &["X", "Årvel-Emberfall-EU", "Paëne-Duskmere-EU"],
        ),
    ] {
        let mut fields = Vec::new();
        split_fields(body, &mut fields);
        assert_eq!(fields, expected, "{body}");
    }
}
