use crate::ParseError;

/// Splits a log line into its timestamp text and its event body (`EVENT,field,…`).
pub fn split_line(line: &str) -> Result<(&str, &str), ParseError> {
    line.split_once("  ").ok_or(ParseError::MissingSeparator)
}

/// Splits an event body into fields; `out` is cleared first so callers can reuse it.
///
/// Commas inside `"…"`, `[…]` and `(…)` do not split. Surrounding quotes are removed.
/// Splitting at ASCII bytes is UTF-8 safe because multi-byte sequences never contain them.
pub fn split_fields<'a>(body: &'a str, out: &mut Vec<&'a str>) {
    out.clear();
    let mut start = 0;
    let mut depth = 0u32;
    let mut in_quotes = false;
    for (i, byte) in body.bytes().enumerate() {
        match byte {
            b'"' => in_quotes = !in_quotes,
            b'[' | b'(' if !in_quotes => depth += 1,
            b']' | b')' if !in_quotes => depth = depth.saturating_sub(1),
            b',' if !in_quotes && depth == 0 => {
                out.push(unquote(&body[start..i]));
                start = i + 1;
            }
            _ => {}
        }
    }
    out.push(unquote(&body[start..]));
}

fn unquote(field: &str) -> &str {
    field
        .strip_prefix('"')
        .and_then(|inner| inner.strip_suffix('"'))
        .unwrap_or(field)
}
