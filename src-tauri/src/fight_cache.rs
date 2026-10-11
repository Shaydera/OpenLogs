use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use openlogs_analysis::{Fight, load_fight_file};
use openlogs_index::{FightSummary, load_or_build};

use crate::commands::describe;
use crate::state::index_cache_dir;

#[derive(Debug, Clone, PartialEq, Eq)]
struct Key {
    path: String,
    fight_index: u32,
    size: u64,
    modified: Option<SystemTime>,
}

/// Pulls kept loaded: the shown pull and the one it is compared with.
const CAPACITY: usize = 2;

type Entry = (Key, FightSummary, Arc<Fight>);

/// The most recently used pulls. Tabs, filters and a comparison of two pulls reuse them
/// instead of re-reading the log.
#[derive(Default)]
pub struct FightCache {
    /// Most recently used first; at most [`CAPACITY`] entries.
    entries: Mutex<Vec<Entry>>,
}

impl FightCache {
    pub fn get(
        &self,
        path: &Path,
        data_dir: &Path,
        fight_index: u32,
    ) -> Result<(FightSummary, Arc<Fight>), String> {
        let metadata = fs::metadata(path).map_err(|err| describe(path, &err))?;
        let key = Key {
            path: path.display().to_string(),
            fight_index,
            size: metadata.len(),
            modified: metadata.modified().ok(),
        };
        if let Ok(mut entries) = self.entries.lock()
            && let Some(position) = entries.iter().position(|(cached, _, _)| *cached == key)
        {
            let entry = entries.remove(position);
            let found = (entry.1.clone(), Arc::clone(&entry.2));
            entries.insert(0, entry);
            return Ok(found);
        }
        let (index, _) =
            load_or_build(path, &index_cache_dir(data_dir)).map_err(|err| describe(path, &err))?;
        let summary = index
            .fights
            .into_iter()
            .find(|fight| fight.index == fight_index)
            .ok_or_else(|| format!("Pull {fight_index} does not exist in this log."))?;
        let fight = Arc::new(load_fight_file(path, &summary).map_err(|err| describe(path, &err))?);
        if let Ok(mut entries) = self.entries.lock() {
            // A copy of the same pull from before the file changed goes first.
            entries.retain(|(cached, _, _)| {
                cached.path != key.path || cached.fight_index != key.fight_index
            });
            entries.insert(0, (key, summary.clone(), Arc::clone(&fight)));
            entries.truncate(CAPACITY);
        }
        Ok((summary, fight))
    }
}

#[cfg(test)]
mod tests {
    use std::fs::{self, OpenOptions};
    use std::io::Write;
    use std::sync::Arc;

    use super::*;

    const FIXTURE: &str = include_str!("../../crates/openlogs-index/tests/fixtures/mini_raid.txt");

    #[test]
    fn keeps_the_two_most_recent_pulls_until_the_file_changes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("WoWCombatLog-test.txt");
        fs::write(&path, FIXTURE).unwrap();
        let cache = FightCache::default();
        let get = |index| cache.get(&path, dir.path(), index).unwrap().1;

        let one = get(1);
        let three = get(3);
        assert!(Arc::ptr_eq(&one, &get(1)), "a compared pair stays loaded");
        assert!(Arc::ptr_eq(&three, &get(3)));
        let two = get(2);
        assert!(Arc::ptr_eq(&three, &get(3)));
        assert!(Arc::ptr_eq(&two, &get(2)));
        assert!(
            !Arc::ptr_eq(&one, &get(1)),
            "the least recent pull was dropped"
        );

        let before = get(1);
        let mut file = OpenOptions::new().append(true).open(&path).unwrap();
        write!(file, "\n10/7/2026 19:40:00.0000  WORLD_MARKER_REMOVED,0\n").unwrap();
        drop(file);
        assert!(
            !Arc::ptr_eq(&before, &get(1)),
            "an appended file is reloaded"
        );
    }
}
