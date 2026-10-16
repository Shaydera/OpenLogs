//! Static and downloaded game data: classes and specs, spell icons, channel spells, Mythic+
//! dungeons and boss portraits.

mod boss_portraits;
mod channel_spells;
mod curated;
mod download;
mod dungeons;
mod fetch;
#[cfg(feature = "http")]
mod http_fetch;
mod icon_name;
mod specs;
mod spell_icons;

pub use boss_portraits::{BossPortraitError, BossPortraitTable};
pub use channel_spells::{ChannelSpellError, ChannelSpells};
pub use curated::{
    CONSUMABLES_FILE, Consumable, ConsumableKind, ConsumableList, CooldownCategory, CooldownList,
    CooldownSpell, Curated, DEFENSIVES_FILE, DefensiveList, MAJOR_CDS_FILE, NamePattern,
    PHASE_NAMES_FILE, PHASES_DIR, PLAYER_COOLDOWNS_FILE, PROCS_FILE, PersonalDefensive,
    PhaseConfig, PhaseNameList, PhaseNames, PhaseRule, PhaseTrigger, PlayerCooldown,
    PlayerCooldownKind, PlayerCooldownList, ProcList, ProcSpell, RAID_FRAME_AURAS_FILE,
    RaidFrameAura, RaidFrameAuras,
};
pub use download::{
    DownloadError, SpellTables, WAGO_DUNGEON_ENCOUNTER_URL, WAGO_JOURNAL_ENCOUNTER_CREATURE_URL,
    WAGO_JOURNAL_ENCOUNTER_URL, WAGO_MANIFEST_URL, WAGO_MAP_CHALLENGE_MODE_URL,
    WAGO_SPELL_MISC_URL, download_boss_portraits, download_dungeons, download_spell_tables,
};
pub use dungeons::{Dungeon, DungeonBoss, DungeonTable, DungeonTableError, KeyTimer};
pub use fetch::{Fetch, FetchError};
#[cfg(feature = "http")]
pub use http_fetch::HttpFetch;
pub use icon_name::is_valid_icon_name;
pub use specs::{ClassInfo, Role, SpecInfo, class, classes, spec, specs};
pub use spell_icons::{SpellIconError, SpellIconTable};
