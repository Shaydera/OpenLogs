/// zamimg icon name for a game file name: lowercase, without `.blp`, spaces as `-`.
pub fn icon_name_from_file(file_name: &str) -> String {
    let lower = file_name.to_ascii_lowercase();
    lower
        .strip_suffix(".blp")
        .unwrap_or(&lower)
        .replace(' ', "-")
}

/// Whether `name` is safe both as a cache file name and as a URL path segment.
pub fn is_valid_icon_name(name: &str) -> bool {
    (1..=128).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
        && !is_reserved_on_windows(name)
}

/// Device names Windows reserves for any file name, with or without extension.
fn is_reserved_on_windows(name: &str) -> bool {
    matches!(name, "con" | "prn" | "aux" | "nul")
        || ["com", "lpt"].iter().any(|prefix| {
            name.strip_prefix(prefix)
                .is_some_and(|n| matches!(n.as_bytes(), [b'1'..=b'9']))
        })
}
