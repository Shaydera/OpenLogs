use crate::combat::parse_combat;
use crate::event::{
    ChallengeModeEnd, ChallengeModeStart, CombatantInfo, EncounterEnd, EncounterStart, Event,
    LogLine,
};
use crate::fields::Fields;
use crate::tokenize::{split_fields, split_line};
use crate::{ParseError, Timestamp};

/// Parses one log line without its line terminator. `fields` is scratch space that callers
/// reuse across lines to avoid allocations.
pub fn parse_line<'a>(line: &'a str, fields: &mut Vec<&'a str>) -> Result<LogLine<'a>, ParseError> {
    let (timestamp, body) = split_line(line)?;
    let timestamp = Timestamp::parse(timestamp)?;
    split_fields(body, fields);
    let event = parse_event(&Fields::new(fields))?;
    Ok(LogLine { timestamp, event })
}

/// [`parse_line`] with its own scratch buffer, for tests and one-off lines.
pub fn parse(line: &str) -> Result<LogLine<'_>, ParseError> {
    parse_line(line, &mut Vec::new())
}

/// Reads only the timestamp and the event name, for callers that skip most lines.
pub fn parse_header(line: &str) -> Result<(Timestamp, &str), ParseError> {
    let (timestamp, body) = split_line(line)?;
    let name = body.split_once(',').map_or(body, |(name, _)| name);
    Ok((Timestamp::parse(timestamp)?, name))
}

fn parse_event<'a>(f: &Fields<'_, 'a>) -> Result<Event<'a>, ParseError> {
    Ok(match f.name {
        "COMBAT_LOG_VERSION" => Event::CombatLogVersion {
            version: f.num(1)?,
            advanced: f.flag(3)?,
            build: f.str(5)?,
        },
        "ZONE_CHANGE" => Event::ZoneChange {
            zone_id: f.num(1)?,
            name: f.str(2)?,
            difficulty: f.num(3)?,
        },
        "ENCOUNTER_START" => Event::EncounterStart(EncounterStart {
            encounter_id: f.num(1)?,
            name: f.str(2)?,
            difficulty: f.num(3)?,
            group_size: f.num(4)?,
            instance_id: f.num(5)?,
        }),
        "ENCOUNTER_END" => Event::EncounterEnd(EncounterEnd {
            encounter_id: f.num(1)?,
            name: f.str(2)?,
            difficulty: f.num(3)?,
            group_size: f.num(4)?,
            success: f.flag(5)?,
            duration_ms: f.num(6)?,
        }),
        "CHALLENGE_MODE_START" => Event::ChallengeModeStart(ChallengeModeStart {
            zone_name: f.str(1)?,
            instance_id: f.num(2)?,
            challenge_mode_id: f.num(3)?,
            keystone_level: f.num(4)?,
            affixes: f.get(5).unwrap_or(""),
        }),
        "CHALLENGE_MODE_END" => Event::ChallengeModeEnd(ChallengeModeEnd {
            instance_id: f.num(1)?,
            success: f.flag(2)?,
            keystone_level: f.num(3)?,
            // Whole milliseconds in the format we know; a fractional value still reads.
            total_time_ms: f.num::<f64>(4)?.max(0.0).round() as u64,
        }),
        "COMBATANT_INFO" => Event::CombatantInfo(CombatantInfo {
            guid: f.str(1)?,
            faction: f.num(2)?,
            spec_id: f.num(25)?,
        }),
        name => match parse_combat(f)? {
            Some(event) => Event::Combat(event),
            None => Event::Unhandled { name },
        },
    })
}
