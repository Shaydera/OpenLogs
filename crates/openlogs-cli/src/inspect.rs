use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;

use openlogs_index::GameFlavor;
use openlogs_parser::{Event, Lines, ParseError, parse_line};

use crate::format::thousands;

/// Every event of a log with its line and field counts and a sample line, to see where a
/// log differs from the layout the parser expects.
#[derive(Debug, Default)]
pub struct Census<'a> {
    pub events: BTreeMap<&'a str, EventStats<'a>>,
    /// The first `COMBAT_LOG_VERSION` line.
    pub header: Option<Event<'a>>,
    /// Difficulty IDs by the event that logged them.
    pub difficulties: BTreeMap<&'static str, BTreeSet<u32>>,
    /// Lines without a readable timestamp or event name.
    pub unreadable: u64,
}

#[derive(Debug)]
pub struct EventStats<'a> {
    pub lines: u64,
    pub broken: u64,
    pub unhandled: bool,
    pub min_fields: usize,
    pub max_fields: usize,
    pub sample: &'a str,
    pub broken_sample: Option<BrokenSample<'a>>,
}

#[derive(Debug)]
pub struct BrokenSample<'a> {
    pub line: &'a str,
    pub fields: usize,
    pub error: ParseError,
}

pub fn census(data: &[u8]) -> Census<'_> {
    let mut census = Census::default();
    let mut fields = Vec::with_capacity(64);
    for raw in Lines::new(data) {
        if raw.bytes.is_empty() {
            continue;
        }
        let Ok(text) = raw.text() else {
            census.unreadable += 1;
            continue;
        };
        let (unhandled, error) = match parse_line(text, &mut fields) {
            Ok(line) => {
                census.observe(&line.event);
                (matches!(line.event, Event::Unhandled { .. }), None)
            }
            Err(error @ (ParseError::MissingField { .. } | ParseError::InvalidField { .. })) => {
                (false, Some(error))
            }
            Err(_) => {
                census.unreadable += 1;
                continue;
            }
        };
        let stats = census
            .events
            .entry(fields[0])
            .or_insert_with(|| EventStats {
                lines: 0,
                broken: 0,
                unhandled: false,
                min_fields: fields.len(),
                max_fields: fields.len(),
                sample: text,
                broken_sample: None,
            });
        stats.lines += 1;
        stats.min_fields = stats.min_fields.min(fields.len());
        stats.max_fields = stats.max_fields.max(fields.len());
        stats.unhandled |= unhandled;
        if let Some(error) = error {
            stats.broken += 1;
            stats.broken_sample.get_or_insert(BrokenSample {
                line: text,
                fields: fields.len(),
                error,
            });
        }
    }
    census
}

impl<'a> Census<'a> {
    fn observe(&mut self, event: &Event<'a>) {
        let (source, difficulty) = match event {
            Event::CombatLogVersion { .. } => {
                self.header.get_or_insert(*event);
                return;
            }
            Event::ZoneChange { difficulty, .. } => ("ZONE_CHANGE", *difficulty),
            Event::EncounterStart(start) => ("ENCOUNTER_START", start.difficulty),
            _ => return,
        };
        self.difficulties
            .entry(source)
            .or_default()
            .insert(difficulty);
    }
}

/// The census as text for `openlogs-cli inspect`.
pub fn report(census: &Census<'_>) -> String {
    let mut out = String::new();
    match census.header {
        Some(Event::CombatLogVersion {
            version,
            advanced,
            build,
            project_id,
        }) => {
            let game = GameFlavor::describe(project_id.map(GameFlavor::from_project_id));
            let advanced = if advanced { "on" } else { "off" };
            let _ = writeln!(
                out,
                "{game}, log version {version}, build {build}, advanced logging {advanced}"
            );
        }
        _ => match census
            .events
            .get("COMBAT_LOG_VERSION")
            .and_then(|stats| stats.broken_sample.as_ref())
        {
            Some(broken) => {
                let _ = writeln!(out, "COMBAT_LOG_VERSION is unreadable: {}", broken.error);
                let _ = writeln!(out, "  {}", broken.line);
            }
            None => {
                let _ = writeln!(out, "No COMBAT_LOG_VERSION line");
            }
        },
    }
    for (source, ids) in &census.difficulties {
        let ids: Vec<String> = ids.iter().map(u32::to_string).collect();
        let _ = writeln!(out, "Difficulties in {source}: {}", ids.join(", "));
    }
    let _ = writeln!(out, "Unreadable lines: {}", census.unreadable);

    let _ = writeln!(out);
    let _ = writeln!(
        out,
        "{:<34} {:>12} {:>10}  Fields",
        "Event (* not modelled)", "Lines", "Broken"
    );
    for (name, stats) in &census.events {
        let name = if stats.unhandled {
            format!("{name}*")
        } else {
            name.to_string()
        };
        let _ = writeln!(
            out,
            "{name:<34} {:>12} {:>10}  {}",
            thousands(stats.lines),
            thousands(stats.broken),
            field_range(stats)
        );
    }

    let _ = writeln!(out);
    let _ = writeln!(out, "Samples");
    for (name, stats) in &census.events {
        let _ = writeln!(out, "{name} ({} fields)", field_range(stats));
        let _ = writeln!(out, "  {}", stats.sample);
        if let Some(broken) = &stats.broken_sample {
            let _ = writeln!(out, "  broken, {} fields: {}", broken.fields, broken.error);
            let _ = writeln!(out, "  {}", broken.line);
        }
    }
    out
}

fn field_range(stats: &EventStats<'_>) -> String {
    if stats.min_fields == stats.max_fields {
        stats.min_fields.to_string()
    } else {
        format!("{}-{}", stats.min_fields, stats.max_fields)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOG: &str = concat!(
        "10/7/2026 18:58:23.0202  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,1.60.1.70450,PROJECT_ID,7\n",
        "10/7/2026 18:58:23.0202  ZONE_CHANGE,3004,\"The Venomous Abyss\",1\n",
        "10/7/2026 19:03:02.0762  ENCOUNTER_START,3492,\"Ula'tek\",9,23,3004\n",
        "10/7/2026 19:03:03.0000  SPELL_DAMAGE,Player-4101-8E8C0182,\"Faelan-Emberfall-EU\",0x512,0x80000000,Creature-0-1-2-3-4-5,\"Ula'tek\",0x10a48,0x80000000,44425,\"Arcane Barrage\",0x40,Creature-0-1-2-3-4-5,0000000000000000,90,100,0,0,1470,0,0,0,3,0,100,0,1599.81,-1.23,2610,3.1461,93,10,10,-1,64,0,0,0,nil,nil,nil,ST\n",
        "10/7/2026 19:03:04.0000  SPELL_DAMAGE,Player-4101-8E8C0182,\"Faelan-Emberfall-EU\",0x512,0x80000000\n",
        "10/7/2026 19:03:05.0000  EMOTE,Creature-0-1-2-3-4-5,\"Ula'tek\",0000000000000000,nil,rages\n",
        "not a log line\n",
    );

    #[test]
    fn counts_lines_fields_and_broken_lines_per_event() {
        let census = census(LOG.as_bytes());
        let damage = &census.events["SPELL_DAMAGE"];
        assert_eq!(
            (
                damage.lines,
                damage.broken,
                damage.min_fields,
                damage.max_fields
            ),
            (2, 1, 5, 42)
        );
        let broken = damage.broken_sample.as_ref().unwrap();
        assert_eq!(broken.fields, 5);
        assert!(broken.line.ends_with(",0x80000000"), "{}", broken.line);
        assert!(!damage.unhandled);
        assert!(census.events["EMOTE"].unhandled);
        assert_eq!(census.unreadable, 1);
        assert_eq!(
            census.difficulties,
            BTreeMap::from([
                ("ENCOUNTER_START", BTreeSet::from([9])),
                ("ZONE_CHANGE", BTreeSet::from([1])),
            ])
        );
        assert!(
            report(&census).starts_with("Project 7, log version 22"),
            "{}",
            report(&census)
        );
    }

    #[test]
    fn an_unreadable_header_is_reported_with_its_line() {
        let header = "10/7/2026 18:58:23.0202  COMBAT_LOG_VERSION,x,ADVANCED_LOG_ENABLED,1";
        let text = report(&census(header.as_bytes()));
        assert!(
            text.starts_with("COMBAT_LOG_VERSION is unreadable") && text.contains(header),
            "{text}"
        );
    }
}
