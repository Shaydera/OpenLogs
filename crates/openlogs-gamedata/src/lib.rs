//! Static and downloaded game data: classes and specs, spell icons, Mythic+ dungeons, boss
//! portraits and the icon cache.

mod boss_portraits;
mod curated;
mod dungeons;
mod fetch;
mod icon_cache;
mod icon_name;
mod specs;
mod spell_icons;
mod sync;

pub use boss_portraits::{BossPortraitError, BossPortraitTable};
pub use curated::{
    CONSUMABLES_FILE, Consumable, ConsumableKind, ConsumableList, CooldownCategory, CooldownList,
    CooldownSpell, Curated, DEFENSIVES_FILE, DefensiveList, MAJOR_CDS_FILE, NamePattern,
    PHASE_NAMES_FILE, PHASES_DIR, PLAYER_COOLDOWNS_FILE, PROCS_FILE, PersonalDefensive,
    PhaseConfig, PhaseNameList, PhaseNames, PhaseRule, PhaseTrigger, PlayerCooldown,
    PlayerCooldownKind, PlayerCooldownList, ProcList, ProcSpell,
};
pub use dungeons::{Dungeon, DungeonBoss, DungeonTable, DungeonTableError, KeyTimer};
pub use fetch::{Fetch, FetchError, HttpFetch};
pub use icon_cache::{IconCache, IconError, RPGLOGS_BOSS_URL, ZAMIMG_ICON_URL, ZAMIMG_JOURNAL_URL};
pub use icon_name::is_valid_icon_name;
pub use specs::{ClassInfo, Role, SpecInfo, class, classes, spec, specs};
pub use spell_icons::{SpellIconError, SpellIconTable};
pub use sync::{
    REFRESH_AFTER_SECS, SyncError, SyncOutcome, WAGO_DUNGEON_ENCOUNTER_URL,
    WAGO_JOURNAL_ENCOUNTER_CREATURE_URL, WAGO_JOURNAL_ENCOUNTER_URL, WAGO_MANIFEST_URL,
    WAGO_MAP_CHALLENGE_MODE_URL, WAGO_SPELL_MISC_URL, fetched_unix_s, load_cached,
    load_cached_boss_portraits, load_cached_dungeons, load_or_sync, load_or_sync_boss_portraits,
    load_or_sync_dungeons, refresh_boss_portraits, refresh_dungeons, refresh_spell_icons,
};
