use openlogs_parser::{
    ChallengeModeEnd, ChallengeModeStart, CombatantInfo, EncounterEnd, EncounterStart, Event,
    ParseError, Timestamp, parse, parse_header,
};

fn event(line: &str) -> Event<'_> {
    parse(line).unwrap().event
}

#[test]
fn parses_log_encounter_and_key_events() {
    for (line, expected) in [
        (
            "10/7/2026 18:58:23.0202  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.1.0,PROJECT_ID,1",
            Event::CombatLogVersion {
                version: 22,
                advanced: true,
                build: "12.1.0",
            },
        ),
        (
            r#"10/7/2026 18:58:23.0202  ZONE_CHANGE,3004,"The Venomous Abyss",15"#,
            Event::ZoneChange {
                zone_id: 3004,
                name: "The Venomous Abyss",
                difficulty: 15,
            },
        ),
        (
            r#"10/7/2026 19:03:02.0762  ENCOUNTER_START,3492,"Ula'tek",15,23,3004"#,
            Event::EncounterStart(EncounterStart {
                encounter_id: 3492,
                name: "Ula'tek",
                difficulty: 15,
                group_size: 23,
                instance_id: 3004,
            }),
        ),
        (
            r#"10/7/2026 19:11:00.6882  ENCOUNTER_END,3492,"Ula'tek",15,23,1,478610"#,
            Event::EncounterEnd(EncounterEnd {
                encounter_id: 3492,
                name: "Ula'tek",
                difficulty: 15,
                group_size: 23,
                success: true,
                duration_ms: 478_610,
            }),
        ),
        // Unknown difficulty 233 and a 19 ms pull, both seen in real logs.
        (
            r#"10/7/2026 19:15:16.4292  ENCOUNTER_END,3379,"Nymrissa Wavecaller",233,16,0,19"#,
            Event::EncounterEnd(EncounterEnd {
                encounter_id: 3379,
                name: "Nymrissa Wavecaller",
                difficulty: 233,
                group_size: 16,
                success: false,
                duration_ms: 19,
            }),
        ),
        (
            r#"10/8/2026 20:00:00.0000  CHALLENGE_MODE_START,"Priory of the Sacred Flame",2649,499,12,[10,147,9]"#,
            Event::ChallengeModeStart(ChallengeModeStart {
                zone_name: "Priory of the Sacred Flame",
                instance_id: 2649,
                challenge_mode_id: 499,
                keystone_level: 12,
                affixes: "[10,147,9]",
            }),
        ),
        (
            "10/8/2026 20:31:00.0000  CHALLENGE_MODE_END,2649,1,12,1859624",
            Event::ChallengeModeEnd(ChallengeModeEnd {
                instance_id: 2649,
                success: true,
                keystone_level: 12,
                total_time_ms: 1_859_624,
            }),
        ),
        // Newer patches append fields and may write the time with a fraction.
        (
            "10/8/2026 20:41:00.0000  CHALLENGE_MODE_END,2649,0,12,2459624.0,0.0,2620.0",
            Event::ChallengeModeEnd(ChallengeModeEnd {
                instance_id: 2649,
                success: false,
                keystone_level: 12,
                total_time_ms: 2_459_624,
            }),
        ),
    ] {
        let parsed = parse(line).unwrap();
        assert_eq!(parsed.event, expected, "{line}");
        assert_eq!(
            Some(parsed.timestamp),
            line.split_once("  ")
                .and_then(|(timestamp, _)| Timestamp::parse(timestamp).ok())
        );
    }
}

#[test]
fn combatant_info_from_a_real_log() {
    let text = include_str!("fixtures/combatant_info.txt").trim_end();
    assert_eq!(
        event(text),
        Event::CombatantInfo(CombatantInfo {
            guid: "Player-4101-0EE857C6",
            faction: 1,
            spec_id: 71,
        })
    );
}

#[test]
fn affix_ids_of_a_key_start() {
    for (line, affixes) in [
        (
            r#"10/8/2026 20:00:00.0000  CHALLENGE_MODE_START,"Priory of the Sacred Flame",2649,499,12,[10,147,9]"#,
            vec![10, 147, 9],
        ),
        (
            r#"10/8/2026 20:00:00.0000  CHALLENGE_MODE_START,"Priory of the Sacred Flame",2649,499,2,[]"#,
            vec![],
        ),
        (
            r#"10/8/2026 20:00:00.0000  CHALLENGE_MODE_START,"Priory of the Sacred Flame",2649,499,2"#,
            vec![],
        ),
    ] {
        let Event::ChallengeModeStart(start) = event(line) else {
            panic!("not a key start: {line}");
        };
        assert_eq!(start.affix_ids(), affixes, "{line}");
    }
}

#[test]
fn parses_world_marker_placed_and_removed() {
    assert_eq!(
        event("10/7/2026 18:58:24.0242  WORLD_MARKER_PLACED,3004,1,1525.40,11.09"),
        Event::WorldMarkerPlaced {
            instance_id: 3004,
            marker: 1,
            x: 1525.40,
            y: 11.09
        }
    );
    assert_eq!(
        event("10/7/2026 18:58:30.0000  WORLD_MARKER_REMOVED,1"),
        Event::WorldMarkerRemoved { marker: 1 }
    );
}

#[test]
fn parses_map_change() {
    assert_eq!(
        event(
            r#"10/7/2026 18:58:24.0242  MAP_CHANGE,2608,"The Venomous Abyss",885.000000,265.000000,127.500000,-802.500000"#
        ),
        Event::MapChange {
            ui_map_id: 2608,
            name: "The Venomous Abyss",
            max_x: 885.0,
            min_x: 265.0,
            max_y: 127.5,
            min_y: -802.5,
        }
    );
}

#[test]
fn unmodelled_events_are_unhandled() {
    for (line, name) in [
        (
            "9/6/2026 14:18:06.2502  STAGGER_CLEAR,Player-4104-0F71DD92,94.733131",
            "STAGGER_CLEAR",
        ),
        (
            r#"10/7/2026 19:05:17.7982  EMOTE,Vehicle-0-3892-3004-1387-257758-00004679D4,"Ula'tek",0000000000000000,nil,|TInterface\ICONS\INV_Misc_Organ_02.blp:20|t Ula'tek rages and exposes her |cFFFF0000|Hspell:1299526|h[Venomous Heart]|h|r!"#,
            "EMOTE",
        ),
        (
            r#"10/7/2026 19:03:03.1762  SPELL_EXTRA_ATTACKS,Player-4101-2E0D6EAA,"Elowyn-Emberfall-EU",0x514,0x80000000,Player-4101-2E0D6EAA,"Elowyn-Emberfall-EU",0x514,0x80000000,465661,"Skyfury",0x1,1"#,
            "SPELL_EXTRA_ATTACKS",
        ),
    ] {
        assert_eq!(event(line), Event::Unhandled { name });
    }
}

#[test]
fn parse_header_reads_only_timestamp_and_name() {
    let (timestamp, name) =
        parse_header("10/7/2026 19:03:02.2242  SPELL_DAMAGE,Player-4101-ACCA502A,broken").unwrap();
    assert_eq!(
        timestamp,
        Timestamp::parse("10/7/2026 19:03:02.2242").unwrap()
    );
    assert_eq!(name, "SPELL_DAMAGE");
}

#[test]
fn malformed_lines_report_why() {
    let missing = |event: &str, index| ParseError::MissingField {
        event: event.into(),
        index,
    };
    for (line, expected) in [
        ("garbage", ParseError::MissingSeparator),
        (
            "99/99/2026 19:03:02.0762  ZONE_CHANGE,1,\"x\",1",
            ParseError::InvalidTimestamp("99/99/2026 19:03:02.0762".into()),
        ),
        (
            r#"10/7/2026 19:03:02.0762  ENCOUNTER_START,abc,"Ula'tek",15,23,3004"#,
            ParseError::InvalidField {
                event: "ENCOUNTER_START".into(),
                index: 1,
                value: "abc".into(),
            },
        ),
        (
            "10/7/2026 19:11:00.6882  ENCOUNTER_END,3492",
            missing("ENCOUNTER_END", 2),
        ),
        (
            r#"10/8/2026 20:00:00.0000  CHALLENGE_MODE_START,"Priory of the Sacred Flame",2649"#,
            missing("CHALLENGE_MODE_START", 3),
        ),
        (
            "10/8/2026 20:31:00.0000  CHALLENGE_MODE_END,2649,1,12",
            missing("CHALLENGE_MODE_END", 4),
        ),
        (
            r#"10/7/2026 19:03:02.2242  SPELL_DAMAGE,Player-4101-ACCA502A,"Ulvara-Emberfall-EU",0x514,0x80000000,Vehicle-0-3892-3004-1387-257758-00004679D4,"Ula'tek",0x10a48,0x80000000,8092,"Mind Blast",0x20,Vehicle-0-3892-3004-1387-257758-00004679D4,0000000000000000,1268044623,1268079760,0,0,1470,0,0,0,3,0,100,0,1599.81,-1.23,2610,3.1461,93"#,
            missing("SPELL_DAMAGE", 31),
        ),
    ] {
        assert_eq!(parse(line).unwrap_err(), expected, "{line}");
    }
}
