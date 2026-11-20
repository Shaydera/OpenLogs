use thiserror::Error;

/// A wago.tools export lacks a column a table is read from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
#[error("CSV is missing the column {0}")]
pub struct MissingColumn(pub &'static str);

pub(crate) fn column(
    headers: &csv::StringRecord,
    name: &'static str,
) -> Result<usize, MissingColumn> {
    headers
        .iter()
        .position(|header| header == name)
        .ok_or(MissingColumn(name))
}
