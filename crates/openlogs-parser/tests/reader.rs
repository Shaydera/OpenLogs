use openlogs_parser::{Event, Lines, ParseError, RawLine, parse_line};

#[test]
fn lines_carry_their_offsets_without_terminators() {
    type Line = (u64, u64, &'static [u8]);
    let cases: [(&[u8], &[Line]); 4] = [
        (b"A\r\nB\nC", &[(0, 3, b"A"), (3, 5, b"B"), (5, 6, b"C")]),
        (b"A\n", &[(0, 2, b"A")]),
        (b"A\n\nB", &[(0, 2, b"A"), (2, 3, b""), (3, 4, b"B")]),
        (b"", &[]),
    ];
    for (data, expected) in cases {
        let lines: Vec<Line> = Lines::new(data)
            .map(|l| (l.offset, l.next_offset, l.bytes))
            .collect();
        assert_eq!(lines, expected, "{data:?}");
    }
}

#[test]
fn from_offset_starts_mid_buffer() {
    let lines: Vec<_> = Lines::from_offset(b"A\nB\n", 2).map(|l| l.bytes).collect();
    assert_eq!(lines, [&b"B"[..]]);
    assert_eq!(Lines::from_offset(b"A\n", 99).count(), 0);
}

#[test]
fn invalid_utf8_is_reported() {
    let line = RawLine {
        offset: 0,
        next_offset: 2,
        bytes: b"\xff\xfe",
    };
    assert_eq!(line.text(), Err(ParseError::InvalidUtf8));
}

#[test]
fn lines_feed_the_parser_with_a_reused_buffer() {
    let data = "10/7/2026 19:03:02.0762  ENCOUNTER_START,3492,\"Ula'tek\",15,23,3004\r\n\
                10/7/2026 19:11:00.6882  ENCOUNTER_END,3492,\"Ula'tek\",15,23,1,478610\r\n";
    let mut fields = Vec::new();
    let events: Vec<Event<'_>> = Lines::new(data.as_bytes())
        .map(|line| parse_line(line.text().unwrap(), &mut fields).unwrap().event)
        .collect();
    assert!(matches!(events[0], Event::EncounterStart(_)));
    assert!(matches!(events[1], Event::EncounterEnd(_)));
}
