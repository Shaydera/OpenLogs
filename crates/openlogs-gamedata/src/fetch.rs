use std::time::Duration;

use thiserror::Error;

/// Upper bound for one download; `SpellMisc.csv` is about 46 MB.
const MAX_BODY_BYTES: u64 = 256 * 1024 * 1024;

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

/// [`Fetch`] over HTTPS with ureq.
pub struct HttpFetch {
    agent: ureq::Agent,
}

impl HttpFetch {
    /// Small icon downloads: give up quickly so a stalled host does not pin a thread.
    pub fn for_icons() -> Self {
        Self::with_timeout(Duration::from_secs(15))
    }

    /// Large data files (the 46 MB `SpellMisc.csv`): enough time for slow connections.
    pub fn for_bulk_data() -> Self {
        Self::with_timeout(Duration::from_secs(15 * 60))
    }

    fn with_timeout(timeout: Duration) -> Self {
        let config = ureq::Agent::config_builder()
            .timeout_connect(Some(Duration::from_secs(10)))
            .timeout_global(Some(timeout))
            .user_agent("OpenLogs/0.1 (local WoW combat log analyzer)")
            .build();
        Self {
            agent: ureq::Agent::new_with_config(config),
        }
    }
}

impl Fetch for HttpFetch {
    fn get(&self, url: &str) -> Result<Vec<u8>, FetchError> {
        match self.agent.get(url).call() {
            Ok(mut response) => response
                .body_mut()
                .with_config()
                .limit(MAX_BODY_BYTES)
                .read_to_vec()
                .map_err(|err| FetchError::Transport(err.to_string())),
            Err(ureq::Error::StatusCode(code)) => Err(FetchError::Status(code)),
            Err(err) => Err(FetchError::Transport(err.to_string())),
        }
    }
}
