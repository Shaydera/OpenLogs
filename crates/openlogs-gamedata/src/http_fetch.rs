use std::time::Duration;

use crate::fetch::{Fetch, FetchError};

/// Upper bound for one download; `SpellMisc.csv` is about 46 MB.
const MAX_BODY_BYTES: u64 = 256 * 1024 * 1024;

/// [`Fetch`] over HTTPS with ureq.
pub struct HttpFetch {
    agent: ureq::Agent,
}

impl HttpFetch {
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
