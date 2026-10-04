use thiserror::Error;

/// Why a log line could not be parsed. Callers skip such lines and count them.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ParseError {
    #[error("line has no timestamp separator")]
    MissingSeparator,
    #[error("invalid timestamp {0:?}")]
    InvalidTimestamp(String),
    #[error("line is not valid UTF-8")]
    InvalidUtf8,
    #[error("{event}: missing field {index}")]
    MissingField { event: String, index: usize },
    #[error("{event}: invalid value {value:?} in field {index}")]
    InvalidField {
        event: String,
        index: usize,
        value: String,
    },
}
