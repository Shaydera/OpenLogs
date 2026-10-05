use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use thiserror::Error;

use crate::fetch::Fetch;
use crate::icon_name::is_valid_icon_name;

pub const ZAMIMG_ICON_URL: &str = "https://wow.zamimg.com/images/wow/icons/large/";
/// Encounter Journal boss portraits (PNG, 128×64).
pub const ZAMIMG_JOURNAL_URL: &str = "https://wow.zamimg.com/images/wow/journal/";
/// Warcraft Logs boss icons, `<encounterId>-icon.jpg` (56×56 JPEG). Unknown encounters answer 403.
pub const RPGLOGS_BOSS_URL: &str = "https://assets.rpglogs.com/img/warcraft/bosses/";

const JPEG_MAGIC: &[u8] = &[0xFF, 0xD8];
const PNG_MAGIC: &[u8] = &[0x89, b'P', b'N', b'G'];

#[derive(Debug, Error)]
pub enum IconError {
    #[error("invalid icon name {0:?}")]
    InvalidName(String),
    #[error("icon {0} is unavailable")]
    Unavailable(String),
}

/// Icons and boss portraits on disk, each downloaded on first use.
pub struct IconCache<F: Fetch> {
    dir: PathBuf,
    fetch: F,
    /// Files whose download failed in this session; retried by the next `IconCache`.
    failed: Mutex<HashSet<String>>,
    temp_counter: AtomicU64,
}

impl<F: Fetch> IconCache<F> {
    pub fn new(dir: PathBuf, fetch: F) -> Self {
        Self {
            dir,
            fetch,
            failed: Mutex::new(HashSet::new()),
            temp_counter: AtomicU64::new(0),
        }
    }

    /// The fetcher, e.g. for inspecting a test double.
    pub fn fetcher(&self) -> &F {
        &self.fetch
    }

    /// JPEG bytes of `name`, from disk or downloaded once.
    pub fn get(&self, name: &str) -> Result<Vec<u8>, IconError> {
        if !is_valid_icon_name(name) {
            return Err(IconError::InvalidName(name.to_string()));
        }
        self.cached_download(
            &format!("{name}.jpg"),
            &format!("{ZAMIMG_ICON_URL}{name}.jpg"),
            JPEG_MAGIC,
        )
    }

    /// PNG bytes of an Encounter Journal portrait such as `ui-ej-boss-ulatek`.
    pub fn get_journal(&self, name: &str) -> Result<Vec<u8>, IconError> {
        if !is_valid_icon_name(name) {
            return Err(IconError::InvalidName(name.to_string()));
        }
        self.cached_download(
            &format!("{name}.png"),
            &format!("{ZAMIMG_JOURNAL_URL}{name}.png"),
            PNG_MAGIC,
        )
    }

    /// JPEG bytes of Warcraft Logs' icon for boss encounter `encounter_id`, stored as
    /// `wcl-boss-<id>.jpg` (no zamimg icon name starts with `wcl-`).
    pub fn get_boss(&self, encounter_id: u32) -> Result<Vec<u8>, IconError> {
        self.cached_download(
            &format!("wcl-boss-{encounter_id}.jpg"),
            &format!("{RPGLOGS_BOSS_URL}{encounter_id}-icon.jpg"),
            JPEG_MAGIC,
        )
    }

    /// `file_name` from disk, else downloaded from `url` once per session; only bytes starting with
    /// `magic` count (an error page served with status 200 is no image).
    fn cached_download(
        &self,
        file_name: &str,
        url: &str,
        magic: &[u8],
    ) -> Result<Vec<u8>, IconError> {
        let path = self.dir.join(file_name);
        if let Ok(bytes) = fs::read(&path) {
            return Ok(bytes);
        }
        if self.failed().contains(file_name) {
            return Err(IconError::Unavailable(file_name.to_string()));
        }
        // No lock is held while downloading, so icons load in parallel.
        match self.fetch.get(url) {
            Ok(bytes) if bytes.starts_with(magic) => {
                // A failed write only means downloading again next time.
                let _ = self.store(&path, &bytes);
                Ok(bytes)
            }
            _ => {
                self.failed().insert(file_name.to_string());
                Err(IconError::Unavailable(file_name.to_string()))
            }
        }
    }

    fn failed(&self) -> std::sync::MutexGuard<'_, HashSet<String>> {
        self.failed
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn store(&self, path: &Path, bytes: &[u8]) -> io::Result<()> {
        fs::create_dir_all(&self.dir)?;
        let n = self.temp_counter.fetch_add(1, Ordering::Relaxed);
        let temporary = path.with_extension(format!("{}-{n}.tmp", std::process::id()));
        fs::write(&temporary, bytes)?;
        fs::rename(&temporary, path)
    }
}
