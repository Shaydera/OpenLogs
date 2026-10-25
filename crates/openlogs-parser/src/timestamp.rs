use serde::{Deserialize, Serialize};

use crate::ParseError;

const MICROS_PER_SECOND: i64 = 1_000_000;
const MICROS_PER_DAY: i64 = 86_400 * MICROS_PER_SECOND;

/// Wall-clock time of a log line in microseconds since 1970-01-01 00:00:00.
///
/// WoW writes local time without a zone, so only differences between timestamps are
/// meaningful.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
pub struct Timestamp(pub i64);

impl Timestamp {
    /// Parses `M/D/YYYY HH:MM:SS.fff[f][±H]` as written at the start of every log line.
    pub fn parse(text: &str) -> Result<Self, ParseError> {
        parse_parts(text).ok_or_else(|| ParseError::InvalidTimestamp(text.to_string()))
    }

    /// Whole milliseconds from `earlier` to `self`; negative if `self` is earlier.
    pub fn millis_since(self, earlier: Timestamp) -> i64 {
        (self.0 - earlier.0) / 1_000
    }

    /// Hours, minutes and seconds of the day.
    pub fn time_of_day(self) -> (u32, u32, u32) {
        let seconds = self.0.rem_euclid(MICROS_PER_DAY) / MICROS_PER_SECOND;
        (
            (seconds / 3600) as u32,
            (seconds / 60 % 60) as u32,
            (seconds % 60) as u32,
        )
    }
}

fn parse_parts(text: &str) -> Option<Timestamp> {
    let (date, time) = text.split_once(' ')?;
    let mut date_parts = date.split('/');
    let month: u32 = date_parts.next()?.parse().ok()?;
    let day: u32 = date_parts.next()?.parse().ok()?;
    let year: i64 = date_parts.next()?.parse().ok()?;
    if date_parts.next().is_some()
        || !(1970..=9999).contains(&year)
        || !(1..=12).contains(&month)
        || !(1..=days_in_month(year, month)).contains(&day)
    {
        return None;
    }

    let (clock, fraction) = time.split_once('.')?;
    // Some clients append their UTC offset; the local time before it is what the log means.
    let fraction = match fraction.split_once(['+', '-']) {
        Some((fraction, offset))
            if !offset.is_empty() && offset.bytes().all(|b| b.is_ascii_digit()) =>
        {
            fraction
        }
        Some(_) => return None,
        None => fraction,
    };
    let mut clock_parts = clock.split(':');
    let hour: u32 = clock_parts.next()?.parse().ok()?;
    let minute: u32 = clock_parts.next()?.parse().ok()?;
    let second: u32 = clock_parts.next()?.parse().ok()?;
    if clock_parts.next().is_some() || hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    if fraction.is_empty() || fraction.len() > 6 || !fraction.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let fraction_micros = fraction.parse::<i64>().ok()? * 10_i64.pow(6 - fraction.len() as u32);

    let seconds = i64::from(hour * 3600 + minute * 60 + second);
    Some(Timestamp(
        days_from_civil(year, month, day) * MICROS_PER_DAY
            + seconds * MICROS_PER_SECOND
            + fraction_micros,
    ))
}

fn days_in_month(year: i64, month: u32) -> u32 {
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm).
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year.rem_euclid(400);
    let month = i64::from(month);
    let shifted_month = if month > 2 { month - 3 } else { month + 9 };
    let day_of_year = (153 * shifted_month + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}
