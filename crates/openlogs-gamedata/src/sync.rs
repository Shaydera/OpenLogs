use std::ffi::OsString;
use std::fs;
use std::io::{self, BufRead, BufReader};
use std::path::{Path, PathBuf};

use thiserror::Error;

use crate::boss_portraits::{BossPortraitError, BossPortraitTable};
use crate::fetch::{Fetch, FetchError};
use crate::spell_icons::{SpellIconError, SpellIconTable};

pub const WAGO_SPELL_MISC_URL: &str = "https://wago.tools/db2/SpellMisc/csv";
pub const WAGO_MANIFEST_URL: &str = "https://wago.tools/db2/ManifestInterfaceData/csv";
pub const WAGO_JOURNAL_ENCOUNTER_URL: &str = "https://wago.tools/db2/JournalEncounter/csv";
pub const WAGO_JOURNAL_ENCOUNTER_CREATURE_URL: &str =
    "https://wago.tools/db2/JournalEncounterCreature/csv";
/// A table is downloaded again when it is older than this.
pub const REFRESH_AFTER_SECS: u64 = 7 * 24 * 3600;

const HEADER_PREFIX: &str = "# fetched_unix_s=";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncOutcome {
    /// Loaded from disk; younger than [`REFRESH_AFTER_SECS`].
    Fresh,
    /// Downloaded now.
    Downloaded,
    /// Refresh failed; the older table on disk is used.
    Stale,
}

#[derive(Debug, Error)]
pub enum SyncError {
    #[error("download failed: {0}")]
    Fetch(#[from] FetchError),
    #[error("downloaded data is invalid: {0}")]
    Parse(#[from] SpellIconError),
    #[error("downloaded boss portrait data is invalid: {0}")]
    BossPortraits(#[from] BossPortraitError),
}

/// A table built from wago.tools exports and stored as text after a fetch-time line.
trait SyncedTable: Clone + Sized {
    fn download<F: Fetch>(fetch: &F) -> Result<Self, SyncError>;
    fn parse(body: &str) -> Option<Self>;
    fn serialize(&self) -> String;
}

impl SyncedTable for SpellIconTable {
    fn download<F: Fetch>(fetch: &F) -> Result<Self, SyncError> {
        let spell_misc = fetch.get(WAGO_SPELL_MISC_URL)?;
        let manifest = fetch.get(WAGO_MANIFEST_URL)?;
        Ok(Self::from_csv(&spell_misc, &manifest)?)
    }

    fn parse(body: &str) -> Option<Self> {
        Self::from_tsv(body).ok()
    }

    fn serialize(&self) -> String {
        self.to_tsv()
    }
}

impl SyncedTable for BossPortraitTable {
    fn download<F: Fetch>(fetch: &F) -> Result<Self, SyncError> {
        let encounters = fetch.get(WAGO_JOURNAL_ENCOUNTER_URL)?;
        let creatures = fetch.get(WAGO_JOURNAL_ENCOUNTER_CREATURE_URL)?;
        let manifest = fetch.get(WAGO_MANIFEST_URL)?;
        Ok(Self::from_csv(&encounters, &creatures, &manifest)?)
    }

    fn parse(body: &str) -> Option<Self> {
        Self::from_tsv(body).ok()
    }

    fn serialize(&self) -> String {
        self.to_tsv()
    }
}

/// Loads the spell icon table from `path`, downloading it from wago.tools when it is
/// missing, corrupt or older than [`REFRESH_AFTER_SECS`].
pub fn load_or_sync<F: Fetch>(
    path: &Path,
    fetch: &F,
    now_unix_s: u64,
) -> Result<(SpellIconTable, SyncOutcome), SyncError> {
    sync_table(path, fetch, now_unix_s, false)
}

/// The spell icon table stored at `path`, however old, for use while a refresh is running.
pub fn load_cached(path: &Path) -> Option<SpellIconTable> {
    cached_table(path)
}

/// Downloads the spell icon table now, whatever its age ("Refresh now"); a failed download
/// keeps the stored table (`Stale`).
pub fn refresh_spell_icons<F: Fetch>(
    path: &Path,
    fetch: &F,
    now_unix_s: u64,
) -> Result<(SpellIconTable, SyncOutcome), SyncError> {
    sync_table(path, fetch, now_unix_s, true)
}

/// Loads the boss portrait table from `path`, downloading it from wago.tools when it is
/// missing, corrupt or older than [`REFRESH_AFTER_SECS`].
pub fn load_or_sync_boss_portraits<F: Fetch>(
    path: &Path,
    fetch: &F,
    now_unix_s: u64,
) -> Result<(BossPortraitTable, SyncOutcome), SyncError> {
    sync_table(path, fetch, now_unix_s, false)
}

/// Downloads the boss portrait table now, whatever its age.
pub fn refresh_boss_portraits<F: Fetch>(
    path: &Path,
    fetch: &F,
    now_unix_s: u64,
) -> Result<(BossPortraitTable, SyncOutcome), SyncError> {
    sync_table(path, fetch, now_unix_s, true)
}

/// The boss portrait table stored at `path`, however old.
pub fn load_cached_boss_portraits(path: &Path) -> Option<BossPortraitTable> {
    cached_table(path)
}

/// When the table stored at `path` was downloaded, from its first line only (the spell table
/// is about 12 MB). `None` without a stored table or without the header line.
pub fn fetched_unix_s(path: &Path) -> Option<u64> {
    let mut first = String::new();
    BufReader::new(fs::File::open(path).ok()?)
        .read_line(&mut first)
        .ok()?;
    split_header(&first).0
}

/// `force` downloads even a fresh table ("Refresh now").
fn sync_table<T: SyncedTable, F: Fetch>(
    path: &Path,
    fetch: &F,
    now_unix_s: u64,
    force: bool,
) -> Result<(T, SyncOutcome), SyncError> {
    let cached = fs::read_to_string(path).ok().and_then(|text| {
        let (fetched, body) = split_header(&text);
        Some((T::parse(body)?, fetched?))
    });
    if !force
        && let Some((table, fetched)) = &cached
        && now_unix_s.saturating_sub(*fetched) < REFRESH_AFTER_SECS
    {
        return Ok((table.clone(), SyncOutcome::Fresh));
    }
    match T::download(fetch) {
        Ok(table) => {
            // A failed write only means downloading again next start.
            let _ = store(path, &table, now_unix_s);
            Ok((table, SyncOutcome::Downloaded))
        }
        Err(err) => match cached {
            Some((table, _)) => Ok((table, SyncOutcome::Stale)),
            None => Err(err),
        },
    }
}

fn cached_table<T: SyncedTable>(path: &Path) -> Option<T> {
    let text = fs::read_to_string(path).ok()?;
    T::parse(split_header(&text).1)
}

/// The fetch time from the first line, and the text after it. Without that line the whole
/// text is the body.
fn split_header(text: &str) -> (Option<u64>, &str) {
    let (first, rest) = text.split_once('\n').unwrap_or((text, ""));
    match first.strip_prefix(HEADER_PREFIX) {
        Some(value) => (value.trim().parse().ok(), rest),
        None => (None, text),
    }
}

fn store<T: SyncedTable>(path: &Path, table: &T, now_unix_s: u64) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let temporary = temporary_path(path);
    fs::write(
        &temporary,
        format!("{HEADER_PREFIX}{now_unix_s}\n{}", table.serialize()),
    )?;
    fs::rename(&temporary, path)
}

/// `path` with `.tmp` appended, e.g. `spell_icons.tsv.tmp`.
fn temporary_path(path: &Path) -> PathBuf {
    let mut name = OsString::from(path.as_os_str());
    name.push(".tmp");
    PathBuf::from(name)
}
