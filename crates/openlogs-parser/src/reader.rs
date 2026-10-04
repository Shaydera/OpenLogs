use crate::ParseError;

/// One raw line of a log buffer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RawLine<'a> {
    /// Byte offset of the first byte of the line.
    pub offset: u64,
    /// Byte offset just past the line terminator, i.e. where the next line starts.
    pub next_offset: u64,
    /// Line content without `\n` or `\r\n`.
    pub bytes: &'a [u8],
}

impl<'a> RawLine<'a> {
    pub fn text(&self) -> Result<&'a str, ParseError> {
        std::str::from_utf8(self.bytes).map_err(|_| ParseError::InvalidUtf8)
    }
}

/// Iterates the lines of a log buffer (typically a memory map) with their byte offsets.
pub struct Lines<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Lines<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    /// Starts at `offset`, which must be the start of a line (e.g. a fight's start offset).
    pub fn from_offset(data: &'a [u8], offset: u64) -> Self {
        let pos = usize::try_from(offset).map_or(data.len(), |offset| offset.min(data.len()));
        Self { data, pos }
    }
}

impl<'a> Iterator for Lines<'a> {
    type Item = RawLine<'a>;

    fn next(&mut self) -> Option<RawLine<'a>> {
        if self.pos >= self.data.len() {
            return None;
        }
        let start = self.pos;
        let (end, next) = match memchr::memchr(b'\n', &self.data[start..]) {
            Some(i) => (start + i, start + i + 1),
            None => (self.data.len(), self.data.len()),
        };
        self.pos = next;
        let bytes = &self.data[start..end];
        Some(RawLine {
            offset: start as u64,
            next_offset: next as u64,
            bytes: bytes.strip_suffix(b"\r").unwrap_or(bytes),
        })
    }
}
