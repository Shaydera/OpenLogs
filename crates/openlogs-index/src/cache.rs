use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use crate::model::{INDEX_FORMAT_VERSION, LogIndex};
use crate::scan::index_file;

/// Identifies one version of a log file; any change invalidates its cached index.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CacheKey {
    pub path: String,
    pub size: u64,
    pub modified_ms: u64,
    pub format_version: u32,
}

impl CacheKey {
    pub fn for_file(path: &Path) -> io::Result<Self> {
        let canonical = fs::canonicalize(path)?;
        let metadata = fs::metadata(&canonical)?;
        let modified_ms = metadata
            .modified()?
            .duration_since(UNIX_EPOCH)
            .map_or(0, |since| since.as_millis() as u64);
        Ok(Self {
            path: canonical.to_string_lossy().into_owned(),
            size: metadata.len(),
            modified_ms,
            format_version: INDEX_FORMAT_VERSION,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheStatus {
    /// Loaded from the cache.
    Hit,
    /// Indexed and stored in the cache.
    Miss,
    /// Indexed, but the cache could not be written.
    Uncached,
}

#[derive(Deserialize)]
struct CacheFile {
    key: CacheKey,
    index: LogIndex,
}

#[derive(Serialize)]
struct CacheFileRef<'a> {
    key: &'a CacheKey,
    index: &'a LogIndex,
}

/// Returns the index for `log_path`, from `cache_dir` when the file is unchanged.
/// Only failing to read the log is an error; cache problems fall back to re-indexing.
pub fn load_or_build(log_path: &Path, cache_dir: &Path) -> io::Result<(LogIndex, CacheStatus)> {
    let key = CacheKey::for_file(log_path)?;
    let cache_path = cache_file_path(cache_dir, &key);
    if let Some(index) = read_cache(&cache_path, &key) {
        return Ok((index, CacheStatus::Hit));
    }
    let index = index_file(log_path)?;
    let status = match write_cache(&cache_path, &key, &index) {
        Ok(()) => CacheStatus::Miss,
        Err(_) => CacheStatus::Uncached,
    };
    Ok((index, status))
}

fn cache_file_path(cache_dir: &Path, key: &CacheKey) -> PathBuf {
    cache_dir.join(format!("{:016x}.json", fnv1a64(key.path.as_bytes())))
}

/// FNV-1a: stable across Rust versions, unlike `DefaultHasher`.
fn fnv1a64(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |hash, &byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

fn read_cache(path: &Path, key: &CacheKey) -> Option<LogIndex> {
    let file: CacheFile = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    (file.key == *key).then_some(file.index)
}

fn write_cache(path: &Path, key: &CacheKey, index: &LogIndex) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let temporary = path.with_extension("json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec(&CacheFileRef { key, index })?,
    )?;
    fs::rename(&temporary, path)
}
