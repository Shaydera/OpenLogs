// Each test binary uses a different subset of these helpers.
#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::Mutex;

use openlogs_gamedata::{Fetch, FetchError};

/// In-memory `Fetch` that records every requested URL.
#[derive(Default)]
pub struct FakeFetch {
    responses: Mutex<HashMap<String, Result<Vec<u8>, FetchError>>>,
    pub calls: Mutex<Vec<String>>,
}

impl FakeFetch {
    pub fn with(self, url: &str, response: Result<Vec<u8>, FetchError>) -> Self {
        self.responses
            .lock()
            .unwrap()
            .insert(url.to_string(), response);
        self
    }

    pub fn call_count(&self, url: &str) -> usize {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|u| *u == url)
            .count()
    }
}

impl Fetch for FakeFetch {
    fn get(&self, url: &str) -> Result<Vec<u8>, FetchError> {
        self.calls.lock().unwrap().push(url.to_string());
        self.responses
            .lock()
            .unwrap()
            .get(url)
            .cloned()
            .unwrap_or(Err(FetchError::Status(404)))
    }
}

/// Minimal JPEG-looking bytes.
pub fn jpeg(tag: u8) -> Vec<u8> {
    vec![0xFF, 0xD8, 0xFF, tag]
}

/// Minimal PNG-looking bytes.
pub fn png(tag: u8) -> Vec<u8> {
    vec![0x89, b'P', b'N', b'G', tag]
}
