use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum FetchError {
    #[error("HTTP status {0}")]
    Status(u16),
    #[error("network error: {0}")]
    Transport(String),
}

/// Downloads a URL into memory. Abstracted so tests run offline.
pub trait Fetch: Send + Sync {
    fn get(&self, url: &str) -> Result<Vec<u8>, FetchError>;
}
