//! Static and downloaded game data: classes and specs, spell icons, channel spells, Mythic+
//! dungeons, boss portraits and the replay's map art index.

mod boss_portraits;
mod channel_spells;
mod curated;
mod download;
mod dungeons;
mod fetch;
#[cfg(feature = "http")]
mod http_fetch;
mod icon_name;
mod map_art;
mod specs;
mod spell_icons;

pub use boss_portraits::{BossPortraitError, BossPortraitTable};
pub use channel_spells::{ChannelSpellError, ChannelSpells};
pub use curated::{
    BOSS_EFFECTS_DIR, BossEffects, CONSUMABLES_FILE, Consumable, ConsumableKind, ConsumableList,
    CooldownCategory, CooldownList, CooldownSpell, Curated, DEFENSIVES_FILE, DefensiveList,
    EffectAnchor, EffectCategory, EffectDef, EffectDuration, EffectKind, EffectList, EffectTrigger,
    Evidence, MAJOR_CDS_FILE, NamePattern, PHASE_NAMES_FILE, PHASES_DIR, PLAYER_COOLDOWNS_FILE,
    PROCS_FILE, PersonalDefensive, PhaseConfig, PhaseNameList, PhaseNames, PhaseRule, PhaseTrigger,
    PlayerCooldown, PlayerCooldownKind, PlayerCooldownList, ProcList, ProcSpell, RAID_EFFECTS_FILE,
    RAID_FRAME_AURAS_FILE, RaidFrameAura, RaidFrameAuras,
};
pub use download::{
    DownloadError, SpellTables, WAGO_AREA_TABLE_URL, WAGO_DUNGEON_ENCOUNTER_URL,
    WAGO_JOURNAL_ENCOUNTER_CREATURE_URL, WAGO_JOURNAL_ENCOUNTER_URL, WAGO_MANIFEST_URL,
    WAGO_MAP_CHALLENGE_MODE_URL, WAGO_MAP_URL, WAGO_SPELL_MISC_URL, WAGO_UI_MAP_ASSIGNMENT_URL,
    WAGO_UI_MAP_GROUP_MEMBER_URL, download_boss_portraits, download_dungeons, download_map_art,
    download_spell_tables,
};
pub use dungeons::{Dungeon, DungeonBoss, DungeonTable, DungeonTableError, KeyTimer};
pub use fetch::{Fetch, FetchError};
#[cfg(feature = "http")]
pub use http_fetch::HttpFetch;
pub use icon_name::is_valid_icon_name;
pub use map_art::{BossPin, MapArt, MapArtError, MapArtTable};
pub use specs::{ClassInfo, Role, SpecInfo, class, classes, spec, specs};
pub use spell_icons::{SpellIconError, SpellIconTable};
