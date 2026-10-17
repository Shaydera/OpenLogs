use std::fs::File;
use std::path::Path;

use openlogs_parser::{Lines, RawLine, parse_header, parse_line};

use crate::builder::{IndexBuilder, LineSpan};
use crate::model::LogIndex;

/// Events that matter to the index even outside fights. Mythic+ runs start, end and list
/// their players between boss pulls.
const META_EVENTS: [&str; 8] = [
    "COMBAT_LOG_VERSION",
    "ENCOUNTER_START",
    "ZONE_CHANGE",
    "CHALLENGE_MODE_START",
    "CHALLENGE_MODE_END",
    "COMBATANT_INFO",
    "WORLD_MARKER_PLACED",
    "WORLD_MARKER_REMOVED",
];

/// A longer line is no combat log line. It counts as broken instead of being kept, which bounds
/// the memory a wrong file (a video, an archive) can take.
const MAX_LINE_BYTES: u64 = 1 << 20;

/// Indexes a log that arrives in chunks of any size, e.g. while streaming a file. Lines
/// outside fights are only read up to their event name, which keeps indexing fast on
/// trash-heavy logs.
#[derive(Default)]
pub struct Indexer {
    builder: IndexBuilder,
    partial_line: Vec<u8>,
    partial_len: u64,
    offset: u64,
}

impl Indexer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Indexes the complete lines in `chunk` and keeps a trailing partial line for the
    /// next chunk.
    pub fn feed(&mut self, chunk: &[u8]) {
        let Some(last_newline) = chunk.iter().rposition(|&b| b == b'\n') else {
            self.keep_partial(chunk);
            return;
        };
        let (mut complete, rest) = chunk.split_at(last_newline + 1);
        if self.partial_len > 0 {
            let line_end = complete
                .iter()
                .position(|&b| b == b'\n')
                .map_or(0, |i| i + 1);
            self.keep_partial(&complete[..line_end]);
            self.push_partial();
            complete = &complete[line_end..];
        }
        self.push_lines(complete);
        self.keep_partial(rest);
    }

    pub fn finish(mut self) -> LogIndex {
        self.push_partial();
        self.builder.finish()
    }

    fn keep_partial(&mut self, bytes: &[u8]) {
        self.partial_len += bytes.len() as u64;
        if self.partial_len <= MAX_LINE_BYTES {
            self.partial_line.extend_from_slice(bytes);
        } else {
            self.partial_line.clear();
        }
    }

    fn push_partial(&mut self) {
        if self.partial_len > MAX_LINE_BYTES {
            let offset = self.offset;
            self.offset += self.partial_len;
            self.builder.push_broken(LineSpan {
                offset,
                next_offset: self.offset,
            });
        } else {
            let line = std::mem::take(&mut self.partial_line);
            self.push_lines(&line);
            self.partial_line = line;
            self.partial_line.clear();
        }
        self.partial_len = 0;
    }

    fn push_lines(&mut self, data: &[u8]) {
        let mut fields = Vec::with_capacity(64);
        for raw in Lines::new(data) {
            self.push_line(raw, &mut fields);
        }
        self.offset += data.len() as u64;
    }

    fn push_line<'a>(&mut self, raw: RawLine<'a>, fields: &mut Vec<&'a str>) {
        if raw.bytes.is_empty() {
            return;
        }
        let span = LineSpan {
            offset: self.offset + raw.offset,
            next_offset: self.offset + raw.next_offset,
        };
        let Ok(text) = raw.text() else {
            self.builder.push_broken(span);
            return;
        };
        if !self.builder.in_fight() {
            match parse_header(text) {
                Ok((timestamp, name)) if !META_EVENTS.contains(&name) => {
                    self.builder.push_skipped(span, timestamp);
                    return;
                }
                Ok(_) => {}
                Err(_) => {
                    self.builder.push_broken(span);
                    return;
                }
            }
        }
        match parse_line(text, fields) {
            Ok(line) => self.builder.push(span, &line),
            Err(_) => self.builder.push_broken(span),
        }
    }
}

/// Indexes a complete log held in memory.
pub fn index_bytes(data: &[u8]) -> LogIndex {
    let mut indexer = Indexer::new();
    indexer.feed(data);
    indexer.finish()
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
