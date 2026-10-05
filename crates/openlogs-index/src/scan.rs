use std::fs::File;
use std::path::Path;

use openlogs_parser::{Lines, parse_header, parse_line};

use crate::builder::{IndexBuilder, LineSpan};
use crate::model::LogIndex;

/// Events that matter to the index even outside fights.
const META_EVENTS: [&str; 3] = ["COMBAT_LOG_VERSION", "ENCOUNTER_START", "ZONE_CHANGE"];

/// Indexes a complete log held in memory. Lines outside fights are only read up to their
/// event name, which keeps indexing fast on trash-heavy logs.
pub fn index_bytes(data: &[u8]) -> LogIndex {
    let mut builder = IndexBuilder::new();
    let mut fields = Vec::with_capacity(64);
    for raw in Lines::new(data) {
        if raw.bytes.is_empty() {
            continue;
        }
        let span = LineSpan {
            offset: raw.offset,
            next_offset: raw.next_offset,
        };
        let Ok(text) = raw.text() else {
            builder.push_broken(span);
            continue;
        };
        if !builder.in_fight() {
            match parse_header(text) {
                Ok((timestamp, name)) if !META_EVENTS.contains(&name) => {
                    builder.push_skipped(span, timestamp);
                    continue;
                }
                Ok(_) => {}
                Err(_) => {
                    builder.push_broken(span);
                    continue;
                }
            }
        }
        match parse_line(text, &mut fields) {
            Ok(line) => builder.push(span, &line),
            Err(_) => builder.push_broken(span),
        }
    }
    builder.finish()
}

/// Memory-maps and indexes a log file.
pub fn index_file(path: &Path) -> std::io::Result<LogIndex> {
    let file = File::open(path)?;
    if file.metadata()?.len() == 0 {
        return Ok(LogIndex::empty());
    }
    // SAFETY: the map is read-only. WoW only appends to the log, which leaves the mapped
    // prefix intact. Truncating the file while it is mapped is undefined behaviour, which
    // we accept for a local single-user tool.
    let map = unsafe { memmap2::Mmap::map(&file)? };
    Ok(index_bytes(&map))
}
