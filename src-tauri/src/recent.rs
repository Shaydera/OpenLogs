use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const MAX_RECENT: usize = 12;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    pub path: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub zone: Option<String>,
    pub start_unix_ms: Option<i64>,
    pub pull_count: u32,
    pub opened_at_unix_ms: i64,
}

/// Recently opened logs, most recent first.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecentLogs {
    entries: Vec<RecentEntry>,
}

impl RecentLogs {
    /// A missing or unreadable file gives an empty list.
    pub fn load(path: &Path) -> Self {
        fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    /// [`Self::load`] with the entries normalized; a changed list is saved back, so stored
    /// duplicates (one log under two spellings) disappear.
    pub fn load_normalized(path: &Path) -> Self {
        let mut recent = Self::load(path);
        if recent.normalize() {
            // Failing to save only means cleaning again next start.
            let _ = recent.save(path);
        }
        recent
    }

    pub fn save(&self, path: &Path) -> io::Result<()> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let temporary = path.with_extension("json.tmp");
        fs::write(&temporary, serde_json::to_vec_pretty(self)?)?;
        fs::rename(&temporary, path)
    }

    /// Puts `entry` first, replacing an older entry for the same file.
    pub fn touch(&mut self, entry: RecentEntry) {
        let key = path_key(&entry.path);
        self.entries
            .retain(|existing| path_key(&existing.path) != key);
        self.entries.insert(0, entry);
        self.entries.truncate(MAX_RECENT);
    }

    pub fn remove(&mut self, path: &str) {
        let key = path_key(path);
        self.entries.retain(|entry| path_key(&entry.path) != key);
    }

    /// Rewrites every entry to its canonical path and drops later entries for the same file
    /// (the list is newest first). Returns whether anything changed.
    pub fn normalize(&mut self) -> bool {
        let before = self.entries.clone();
        let mut seen = HashSet::new();
        self.entries = before
            .iter()
            .cloned()
            .filter_map(|mut entry| {
                entry.path = canonical_path(Path::new(&entry.path))
                    .to_string_lossy()
                    .into_owned();
                seen.insert(path_key(&entry.path)).then_some(entry)
            })
            .collect();
        self.entries != before
    }

    pub fn entries(&self) -> &[RecentEntry] {
        &self.entries
    }
}

/// `path` as the file system names it: canonical and without Windows' `\\?\` prefix. A path
/// that cannot be resolved (the file is gone) stays as it is.
pub fn canonical_path(path: &Path) -> PathBuf {
    match fs::canonicalize(path) {
        Ok(canonical) => without_verbatim_prefix(&canonical),
        Err(_) => path.to_path_buf(),
    }
}

/// `C:\x` for `\\?\C:\x`, `\\server\share` for `\\?\UNC\server\share`.
fn without_verbatim_prefix(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&*text))
}

/// Two spellings of one file give one key: on Windows `/` and `\` and letter case do not matter.
fn path_key(path: &str) -> String {
    if cfg!(windows) {
        path.replace('/', "\\").to_lowercase()
    } else {
        path.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str) -> RecentEntry {
        RecentEntry {
            path: path.to_string(),
            file_name: path.rsplit(['/', '\\']).next().unwrap().to_string(),
            size_bytes: 1,
            zone: None,
            start_unix_ms: None,
            pull_count: 0,
            opened_at_unix_ms: 0,
        }
    }

    fn paths(recent: &RecentLogs) -> Vec<&str> {
        recent.entries().iter().map(|e| e.path.as_str()).collect()
    }

    #[test]
    fn touch_keeps_one_entry_per_file_newest_first() {
        let mut recent = RecentLogs::default();
        for i in 0..20 {
            recent.touch(entry(&format!("{i}.txt")));
        }
        assert_eq!(recent.entries().len(), MAX_RECENT);
        recent.touch(entry("12.txt"));
        assert_eq!(paths(&recent)[..3], ["12.txt", "19.txt", "18.txt"]);
        recent.remove("12.txt");
        assert_eq!(recent.entries().len(), MAX_RECENT - 1);

        if cfg!(windows) {
            let mut recent = RecentLogs::default();
            recent.touch(entry("E:/Logs/a.txt"));
            recent.touch(entry("e:\\logs\\A.txt"));
            assert_eq!(paths(&recent), ["e:\\logs\\A.txt"]);
            recent.remove("E:/LOGS/a.txt");
            assert!(recent.entries().is_empty());
        }
    }

    #[test]
    fn loading_merges_stored_duplicates_and_saves_the_cleaned_list() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("WoWCombatLog-100726_185823.txt");
        fs::write(&log, "x").unwrap();
        let canonical = canonical_path(&log).to_string_lossy().into_owned();
        let spelled = dir
            .path()
            .join(".")
            .join("WoWCombatLog-100726_185823.txt")
            .to_string_lossy()
            .into_owned();
        let gone = dir.path().join("gone.txt").to_string_lossy().into_owned();
        let stored = RecentLogs {
            entries: vec![
                RecentEntry {
                    opened_at_unix_ms: 3,
                    ..entry(&spelled)
                },
                RecentEntry {
                    opened_at_unix_ms: 2,
                    ..entry(&gone)
                },
                RecentEntry {
                    opened_at_unix_ms: 1,
                    ..entry(&log.to_string_lossy())
                },
            ],
        };
        let path = dir.path().join("nested").join("recent.json");
        stored.save(&path).unwrap();

        let recent = RecentLogs::load_normalized(&path);
        let rows: Vec<_> = recent
            .entries()
            .iter()
            .map(|e| (e.path.as_str(), e.opened_at_unix_ms))
            .collect();
        assert_eq!(
            rows,
            [(canonical.as_str(), 3), (gone.as_str(), 2)],
            "a missing file keeps its path"
        );
        assert_eq!(RecentLogs::load(&path), recent, "the cleaned list is saved");
        for (verbatim, plain) in [
            (r"\\?\C:\Logs\a.txt", r"C:\Logs\a.txt"),
            (r"\\?\UNC\server\share\a.txt", r"\\server\share\a.txt"),
        ] {
            assert_eq!(
                without_verbatim_prefix(Path::new(verbatim)),
                Path::new(plain)
            );
        }

        fs::write(&path, "not json").unwrap();
        assert_eq!(RecentLogs::load(&path), RecentLogs::default());
        assert_eq!(
            RecentLogs::load(&dir.path().join("missing.json")),
            RecentLogs::default()
        );
    }
}
