use openlogs_parser::Timestamp;

fn ts(text: &str) -> Timestamp {
    Timestamp::parse(text).unwrap()
}

#[test]
fn parses_microseconds_since_the_epoch() {
    assert_eq!(ts("1/1/1970 00:00:00.0000"), Timestamp(0));
    assert_eq!(ts("1/1/1970 00:00:01.250"), Timestamp(1_250_000));
    assert_eq!(ts("10/7/2026 19:03:02.0762").time_of_day(), (19, 3, 2));
}

#[test]
fn a_utc_offset_suffix_keeps_the_local_time() {
    assert_eq!(
        ts("10/24/2026 20:43:21.034-4"),
        ts("10/24/2026 20:43:21.034")
    );
    assert_eq!(
        ts("10/24/2026 20:43:21.0340+10"),
        ts("10/24/2026 20:43:21.034")
    );
}

#[test]
fn encounter_duration_matches_the_log() {
    // ENCOUNTER_START / ENCOUNTER_END of a real Ula'tek kill (logged duration 478610 ms).
    let start = ts("10/7/2026 19:03:02.0762");
    let end = ts("10/7/2026 19:11:00.6882");
    assert_eq!(end.0 - start.0, 478_612_000);
    assert_eq!(end.millis_since(start), 478_612);
}

#[test]
fn crossing_midnight_and_month_end_is_continuous() {
    let before = ts("10/31/2026 23:59:59.5000");
    let after = ts("11/1/2026 00:00:00.5000");
    assert_eq!(after.0 - before.0, 1_000_000);
}

#[test]
fn rejects_malformed_timestamps_and_impossible_dates() {
    for text in [
        "",
        "garbage",
        "13/1/2026 00:00:00.0000",
        "10/7/2026 24:00:00.0000",
        "10/7/2026 19:03:02",
        "10/7/2026 19:03:02.12x4",
        "10/7/2026 19:03:02.0762-",
        "10/7/2026 19:03:02.0762+4x",
        "10/7/2026 19:03:02.-4",
        "10/7/2026  19:03:02.0762",
        "1/1/300000 00:00:00.000",
        "2/31/2026 00:00:00.0000",
        "2/29/2026 00:00:00.0000",
        "4/31/2026 00:00:00.0000",
        "1/1/1969 00:00:00.0000",
    ] {
        assert!(
            Timestamp::parse(text).is_err(),
            "{text:?} should be rejected"
        );
    }
    assert!(
        Timestamp::parse("2/29/2028 00:00:00.0000").is_ok(),
        "leap day"
    );
}
