use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use openlogs_gamedata::{
    Curated, DungeonTable, Fetch, HttpFetch, IconCache, SyncError, SyncOutcome,
};

use crate::dto::{GameDataStatusDto, TableStatusDto};
use crate::fight_cache::FightCache;
use crate::icons::IconService;
use crate::recent::RecentLogs;

/// The game-data tables downloaded from wago.tools.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DataTable {
    SpellIcons = 0,
    Dungeons = 1,
    BossPortraits = 2,
}

impl DataTable {
    /// Sync order: the small tables first, the 46 MB spell export last.
    pub const ALL: [DataTable; 3] = [
        DataTable::Dungeons,
        DataTable::BossPortraits,
        DataTable::SpellIcons,
    ];
}

/// Shown for a table whose download failed while the stored one stays in use.
pub const STALE_MESSAGE: &str = "The download failed; the stored table stays in use.";

/// Holds `AppState::syncing` while a sync runs and clears it when dropped, also on unwind.
struct SyncRunning<'a>(&'a AtomicBool);

impl Drop for SyncRunning<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// Process-wide state shared by commands and the icon protocol.
pub struct AppState {
    pub data_dir: PathBuf,
    pub recent: Mutex<RecentLogs>,
    pub icons: IconService<HttpFetch>,
    pub curated: Curated,
    pub fight_cache: FightCache,
    /// Mythic+ dungeons; `None` until a table was stored or downloaded once.
    dungeons: RwLock<Option<DungeonTable>>,
    /// Why the last download of each table failed (index `DataTable as usize`).
    sync_errors: Mutex<[Option<String>; 3]>,
    /// Set while `sync_game_data` runs, so a second request does not start another sync.
    syncing: AtomicBool,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> Self {
        let recent = RecentLogs::load_normalized(&data_dir.join("recent.json"));
        let icons = IconService::new(IconCache::new(
            data_dir.join("icons"),
            HttpFetch::for_icons(),
        ));
        // The small stored tables load now, so a log opened right away has them; the spell
        // table (about 12 MB) loads in the sync thread.
        if let Some(table) = openlogs_gamedata::load_cached_boss_portraits(&data_path(
            &data_dir,
            DataTable::BossPortraits,
        )) {
            icons.set_boss_portraits(table);
        }
        let curated = Curated::load(Some(&data_dir.join("curated")));
        for warning in &curated.warnings {
            eprintln!("curated lists: {warning}");
        }
        let dungeons =
            openlogs_gamedata::load_cached_dungeons(&data_path(&data_dir, DataTable::Dungeons));
        Self {
            data_dir,
            recent: Mutex::new(recent),
            icons,
            curated,
            fight_cache: FightCache::default(),
            dungeons: RwLock::new(dungeons),
            sync_errors: Mutex::new(Default::default()),
            syncing: AtomicBool::new(false),
        }
    }

    pub fn recent_path(&self) -> PathBuf {
        self.data_dir.join("recent.json")
    }

    /// The dungeon table as far as it is known now.
    pub fn dungeon_table(&self) -> Option<DungeonTable> {
        self.dungeons.read().ok().and_then(|table| table.clone())
    }

    /// Installs the stored spell table, then downloads every table that is older than 7 days
    /// (all of them with `force`, "Refresh now"). Blocks; run it off the UI thread. Returns
    /// `false` without doing anything while another sync runs.
    pub fn sync_game_data<F: Fetch>(&self, fetch: &F, now_unix_s: u64, force: bool) -> bool {
        if self.syncing.swap(true, Ordering::SeqCst) {
            return false;
        }
        // Clears the flag however the sync ends, a panic in a parser included.
        let _running = SyncRunning(&self.syncing);
        if self.icons.spell_count().is_none()
            && let Some(table) =
                openlogs_gamedata::load_cached(&data_path(&self.data_dir, DataTable::SpellIcons))
        {
            self.icons.set_spell_table(table);
        }
        for table in DataTable::ALL {
            let result = self.sync_one(table, fetch, now_unix_s, force);
            self.record(table, result);
        }
        true
    }

    /// Downloads (or keeps) one table and installs it; returns the outcome and its size.
    fn sync_one<F: Fetch>(
        &self,
        table: DataTable,
        fetch: &F,
        now_unix_s: u64,
        force: bool,
    ) -> Result<(SyncOutcome, usize), SyncError> {
        let path = data_path(&self.data_dir, table);
        Ok(match table {
            DataTable::SpellIcons => {
                let (spells, outcome) = if force {
                    openlogs_gamedata::refresh_spell_icons(&path, fetch, now_unix_s)?
                } else {
                    openlogs_gamedata::load_or_sync(&path, fetch, now_unix_s)?
                };
                let size = spells.len();
                self.icons.set_spell_table(spells);
                (outcome, size)
            }
            DataTable::Dungeons => {
                let (dungeons, outcome) = if force {
                    openlogs_gamedata::refresh_dungeons(&path, fetch, now_unix_s)?
                } else {
                    openlogs_gamedata::load_or_sync_dungeons(&path, fetch, now_unix_s)?
                };
                let size = dungeons.len();
                if let Ok(mut slot) = self.dungeons.write() {
                    *slot = Some(dungeons);
                }
                (outcome, size)
            }
            DataTable::BossPortraits => {
                let (portraits, outcome) = if force {
                    openlogs_gamedata::refresh_boss_portraits(&path, fetch, now_unix_s)?
                } else {
                    openlogs_gamedata::load_or_sync_boss_portraits(&path, fetch, now_unix_s)?
                };
                let size = portraits.len();
                self.icons.set_boss_portraits(portraits);
                (outcome, size)
            }
        })
    }

    fn record(&self, table: DataTable, result: Result<(SyncOutcome, usize), SyncError>) {
        let error = match result {
            Ok((SyncOutcome::Stale, size)) => {
                eprintln!("{table:?}: refresh failed, keeping {size} stored entries");
                Some(STALE_MESSAGE.to_string())
            }
            Ok((outcome, size)) => {
                eprintln!("{table:?}: {outcome:?}, {size} entries");
                None
            }
            Err(err) => {
                eprintln!("{table:?} unavailable: {err}");
                Some(err.to_string())
            }
        };
        if let Ok(mut errors) = self.sync_errors.lock() {
            errors[table as usize] = error;
        }
    }

    /// What the Settings dialog shows about the game data.
    pub fn data_status(&self) -> GameDataStatusDto {
        let errors = self
            .sync_errors
            .lock()
            .map(|errors| errors.clone())
            .unwrap_or_default();
        let status = |table: DataTable, entries: Option<usize>| TableStatusDto {
            entries,
            fetched_unix_ms: openlogs_gamedata::fetched_unix_s(&data_path(&self.data_dir, table))
                .map(|seconds| seconds as i64 * 1000),
            error: errors[table as usize].clone(),
        };
        let dungeons = self
            .dungeons
            .read()
            .ok()
            .and_then(|table| table.as_ref().map(DungeonTable::len));
        GameDataStatusDto {
            spell_icons: status(DataTable::SpellIcons, self.icons.spell_count()),
            dungeons: status(DataTable::Dungeons, dungeons),
            boss_portraits: status(DataTable::BossPortraits, self.icons.portrait_count()),
            refreshing: self.syncing.load(Ordering::SeqCst),
        }
    }
}

pub fn index_cache_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("index-cache")
}

/// Where a game-data table is stored: `<app data>/game-data/<file>`.
pub fn data_path(data_dir: &Path, table: DataTable) -> PathBuf {
    data_dir.join("game-data").join(match table {
        DataTable::SpellIcons => "spell_icons.tsv",
        DataTable::Dungeons => "dungeons.txt",
        DataTable::BossPortraits => "boss_portraits.tsv",
    })
}

pub fn now_unix_s() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_secs())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use openlogs_gamedata::FetchError;

    use super::*;

    const NOW: u64 = 1_791_590_400;
    const SPELL_MISC: &str = "ID,DifficultyID,SpellIconFileDataID,SpellID\n1,0,236205,44425\n";
    const MANIFEST: &str = "ID,FilePath,FileName\n\
        236205,Interface\\ICONS\\,Ability_Mage_ArcaneBarrage.blp\n\
        7966634,Interface\\EncounterJournal\\,UI-EJ-BOSS-Ulatek.blp\n";
    const JOURNAL_ENCOUNTER: &str = "ID,DungeonEncounterID\n2895,3492\n";
    const JOURNAL_ENCOUNTER_CREATURE: &str =
        "ID,JournalEncounterID,FileDataID,OrderIndex\n6186,2895,7966634,0\n";

    /// The wago.tools exports, trimmed.
    struct Exports;

    impl Fetch for Exports {
        fn get(&self, url: &str) -> Result<Vec<u8>, FetchError> {
            let body: &[u8] = match url {
                openlogs_gamedata::WAGO_SPELL_MISC_URL => SPELL_MISC.as_bytes(),
                openlogs_gamedata::WAGO_MANIFEST_URL => MANIFEST.as_bytes(),
                openlogs_gamedata::WAGO_MAP_CHALLENGE_MODE_URL => &include_bytes!(
                    "../../crates/openlogs-gamedata/tests/fixtures/MapChallengeMode.csv"
                )[..],
                openlogs_gamedata::WAGO_DUNGEON_ENCOUNTER_URL => &include_bytes!(
                    "../../crates/openlogs-gamedata/tests/fixtures/DungeonEncounter.csv"
                )[..],
                openlogs_gamedata::WAGO_JOURNAL_ENCOUNTER_URL => JOURNAL_ENCOUNTER.as_bytes(),
                openlogs_gamedata::WAGO_JOURNAL_ENCOUNTER_CREATURE_URL => {
                    JOURNAL_ENCOUNTER_CREATURE.as_bytes()
                }
                _ => return Err(FetchError::Status(404)),
            };
            Ok(body.to_vec())
        }
    }

    struct Offline;

    impl Fetch for Offline {
        fn get(&self, _url: &str) -> Result<Vec<u8>, FetchError> {
            Err(FetchError::Transport("offline".into()))
        }
    }

    fn statuses(status: &GameDataStatusDto) -> [&TableStatusDto; 3] {
        [
            &status.spell_icons,
            &status.dungeons,
            &status.boss_portraits,
        ]
    }

    fn fixture_dungeons() -> DungeonTable {
        DungeonTable::from_csv(
            include_bytes!("../../crates/openlogs-gamedata/tests/fixtures/MapChallengeMode.csv"),
            include_bytes!("../../crates/openlogs-gamedata/tests/fixtures/DungeonEncounter.csv"),
        )
        .unwrap()
    }

    #[test]
    fn stored_tables_are_ready_at_startup() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            AppState::new(dir.path().to_path_buf()).dungeon_table(),
            None
        );

        let dungeons = fixture_dungeons();
        let path = data_path(dir.path(), DataTable::Dungeons);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, format!("# fetched_unix_s=1\n{}", dungeons.to_json())).unwrap();
        fs::write(
            data_path(dir.path(), DataTable::BossPortraits),
            "# fetched_unix_s=7\n3492\tui-ej-boss-ulatek\n",
        )
        .unwrap();
        let state = AppState::new(dir.path().to_path_buf());
        assert_eq!(state.dungeon_table(), Some(dungeons));
        assert_eq!(
            state.data_status().boss_portraits,
            TableStatusDto {
                entries: Some(1),
                fetched_unix_ms: Some(7_000),
                error: None
            }
        );
    }

    #[test]
    fn a_sync_installs_every_table_and_a_failed_refresh_keeps_them() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::new(dir.path().to_path_buf());
        assert!(state.sync_game_data(&Offline, NOW, false));
        for table in statuses(&state.data_status()) {
            assert_eq!(table.entries, None);
            assert!(table.error.as_deref().unwrap().contains("offline"));
        }

        assert!(state.sync_game_data(&Exports, NOW, false));
        let ready = |entries| TableStatusDto {
            entries: Some(entries),
            fetched_unix_ms: Some(NOW as i64 * 1000),
            error: None,
        };
        let status = state.data_status();
        assert_eq!(status.spell_icons, ready(1));
        assert_eq!(status.dungeons, ready(fixture_dungeons().len()));
        assert_eq!(status.boss_portraits, ready(1));
        assert!(!status.refreshing);
        assert_eq!(
            state.icons.resolve("/spell/44425").as_deref(),
            Some("ability_mage_arcanebarrage")
        );

        assert!(state.sync_game_data(&Offline, NOW + 60, true));
        for table in statuses(&state.data_status()) {
            assert!(table.entries.is_some());
            assert_eq!(table.fetched_unix_ms, Some(NOW as i64 * 1000));
            assert_eq!(table.error.as_deref(), Some(STALE_MESSAGE));
        }
    }

    /// A fetcher whose parser or transport panics.
    struct Panics;

    impl Fetch for Panics {
        fn get(&self, _url: &str) -> Result<Vec<u8>, FetchError> {
            panic!("broken export");
        }
    }

    #[test]
    fn only_one_sync_runs_at_a_time_and_a_panic_does_not_block_the_next() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::new(dir.path().to_path_buf());
        state.syncing.store(true, Ordering::SeqCst);
        assert!(!state.sync_game_data(&Exports, NOW, true));
        assert!(state.data_status().refreshing);
        assert_eq!(state.data_status().spell_icons.entries, None);
        state.syncing.store(false, Ordering::SeqCst);

        let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            state.sync_game_data(&Panics, NOW, true)
        }));
        assert!(panicked.is_err());
        assert!(!state.data_status().refreshing);
        assert!(state.sync_game_data(&Exports, NOW, false));
        assert_eq!(state.data_status().spell_icons.entries, Some(1));
    }
}
