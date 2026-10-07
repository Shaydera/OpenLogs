use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;

use openlogs_gamedata::{BossPortraitTable, Fetch, IconCache, SpellIconTable, is_valid_icon_name};
use tauri::http::Response;

/// zamimg icon of a melee swing; the log writes melee as spell 0.
pub const MELEE_ICON: &str = "ability_meleedamage";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Icon {
    pub bytes: Vec<u8>,
    pub content_type: &'static str,
}

/// Resolves `wowicon://` paths to images. Anything that cannot be shown is a 404, so the UI
/// draws its monogram tile instead.
pub struct IconService<F: Fetch> {
    cache: IconCache<F>,
    spells: RwLock<Option<SpellIconTable>>,
    portraits: RwLock<Option<BossPortraitTable>>,
    /// `boss_icons/` shipped with the app (`<encounterId>.jpg|png`), the last image source.
    bundled_boss_dir: RwLock<Option<PathBuf>>,
}

impl<F: Fetch> IconService<F> {
    pub fn new(cache: IconCache<F>) -> Self {
        Self {
            cache,
            spells: RwLock::new(None),
            portraits: RwLock::new(None),
            bundled_boss_dir: RwLock::new(None),
        }
    }

    pub fn set_spell_table(&self, table: SpellIconTable) {
        if let Ok(mut spells) = self.spells.write() {
            *spells = Some(table);
        }
    }

    pub fn set_boss_portraits(&self, table: BossPortraitTable) {
        if let Ok(mut portraits) = self.portraits.write() {
            *portraits = Some(table);
        }
    }

    pub fn set_bundled_boss_icons(&self, dir: PathBuf) {
        if let Ok(mut bundled) = self.bundled_boss_dir.write() {
            *bundled = Some(dir);
        }
    }

    /// Spells of the table in use; `None` before one is loaded.
    pub fn spell_count(&self) -> Option<usize> {
        self.spells.read().ok()?.as_ref().map(SpellIconTable::len)
    }

    /// Encounters of the portrait table in use; `None` before one is loaded.
    pub fn portrait_count(&self) -> Option<usize> {
        self.portraits
            .read()
            .ok()?
            .as_ref()
            .map(BossPortraitTable::len)
    }

    /// Icon name for `spell/<id>`, `class/<id>`, `spec/<id>` or `icon/<name>`; `None` for unknown
    /// spells (also before the table is loaded) and malformed paths. Spell 0 is melee.
    pub fn resolve(&self, path: &str) -> Option<String> {
        let (kind, rest) = split_path(path)?;
        match kind {
            "spell" => {
                let id: u32 = rest.parse().ok()?;
                if id == 0 {
                    return Some(MELEE_ICON.to_string());
                }
                let spells = self.spells.read().ok()?;
                spells.as_ref()?.icon(id).map(str::to_string)
            }
            "class" => Some(openlogs_gamedata::class(rest.parse().ok()?)?.icon()),
            "spec" => Some(openlogs_gamedata::spec(rest.parse().ok()?)?.icon.clone()),
            "icon" if is_valid_icon_name(rest) => Some(rest.to_string()),
            _ => None,
        }
    }

    /// Image bytes for a protocol path; `None` means 404.
    pub fn image(&self, path: &str) -> Option<Icon> {
        if let Some(("boss", rest)) = split_path(path) {
            return self.boss_image(rest.parse().ok()?);
        }
        let name = self.resolve(path)?;
        self.cache
            .get(&name)
            .ok()
            .map(|bytes| icon(bytes, "image/jpeg"))
    }

    /// Warcraft Logs' icon, then the Encounter Journal portrait, then an icon shipped with the app.
    fn boss_image(&self, encounter_id: u32) -> Option<Icon> {
        if let Ok(bytes) = self.cache.get_boss(encounter_id) {
            return Some(icon(bytes, "image/jpeg"));
        }
        let journal = self.portraits.read().ok().and_then(|portraits| {
            portraits
                .as_ref()?
                .portrait(encounter_id)
                .map(str::to_string)
        });
        if let Some(bytes) = journal.and_then(|name| self.cache.get_journal(&name).ok()) {
            return Some(icon(bytes, "image/png"));
        }
        self.bundled_boss_icon(encounter_id)
    }

    fn bundled_boss_icon(&self, encounter_id: u32) -> Option<Icon> {
        let dir = self.bundled_boss_dir.read().ok()?.clone()?;
        let formats: [(&str, &[u8], &'static str); 2] = [
            ("jpg", &[0xFF, 0xD8], "image/jpeg"),
            ("png", &[0x89, b'P', b'N', b'G'], "image/png"),
        ];
        formats
            .into_iter()
            .find_map(|(extension, magic, content_type)| {
                let bytes = fs::read(dir.join(format!("{encounter_id}.{extension}"))).ok()?;
                bytes.starts_with(magic).then(|| icon(bytes, content_type))
            })
    }
}

/// `("spell", "44425")` for `/spell/44425?v=1`; `None` without a kind or with more segments.
fn split_path(path: &str) -> Option<(&str, &str)> {
    let path = path
        .split('?')
        .next()
        .unwrap_or_default()
        .trim_start_matches('/');
    let (kind, rest) = path.split_once('/')?;
    (!rest.contains('/')).then_some((kind, rest))
}

fn icon(bytes: Vec<u8>, content_type: &'static str) -> Icon {
    Icon {
        bytes,
        content_type,
    }
}

/// HTTP response for the icon protocol. A 404 must not be cached: the image may become
/// available once the game data is synced.
pub fn icon_response(icon: Option<Icon>) -> Response<Vec<u8>> {
    let response = match icon {
        Some(Icon {
            bytes,
            content_type,
        }) => Response::builder()
            .status(200)
            .header("Content-Type", content_type)
            .header("Cache-Control", "public, max-age=31536000, immutable")
            .body(bytes),
        None => Response::builder()
            .status(404)
            .header("Cache-Control", "no-store")
            .body(Vec::new()),
    };
    response.expect("static response parts are valid")
}

#[cfg(test)]
mod tests {
    use std::fs;

    use openlogs_gamedata::FetchError;

    use super::*;

    struct NoNetwork;

    impl Fetch for NoNetwork {
        fn get(&self, _url: &str) -> Result<Vec<u8>, FetchError> {
            Err(FetchError::Transport("offline".into()))
        }
    }

    fn service(dir: &std::path::Path) -> IconService<NoNetwork> {
        IconService::new(IconCache::new(dir.to_path_buf(), NoNetwork))
    }

    #[test]
    fn paths_resolve_to_icon_names() {
        let dir = tempfile::tempdir().unwrap();
        let icons = service(dir.path());
        assert_eq!(icons.resolve("/spell/44425"), None, "before the sync");
        assert_eq!(
            icons.resolve("/spell/0").as_deref(),
            Some(MELEE_ICON),
            "melee needs no table"
        );
        icons.set_spell_table(
            SpellIconTable::from_tsv("44425\tability_mage_arcanebarrage\n").unwrap(),
        );
        for (path, name) in [
            ("/spell/44425", Some("ability_mage_arcanebarrage")),
            ("/spell/1", None),
            ("/class/8", Some("classicon_mage")),
            ("/class/99", None),
            ("/spec/1473", Some("classicon_evoker_augmentation")),
            ("/icon/classicon_mage?v=1", Some("classicon_mage")),
        ] {
            assert_eq!(icons.resolve(path).as_deref(), name, "{path}");
        }
    }

    #[test]
    fn malformed_or_missing_images_are_an_uncached_404() {
        let dir = tempfile::tempdir().unwrap();
        let icons = service(&dir.path().join("icons"));
        for path in [
            "",
            "/",
            "/icon/",
            "/icon/../../secrets",
            "/icon/%2e%2e",
            "/icon/ICON",
            "/spell/abc",
            "/spell/1/2",
            "/unknown/1",
            "/icon/spell_missing",
        ] {
            assert!(icons.image(path).is_none(), "{path:?}");
        }
        assert!(!dir.path().join("icons").exists());

        let missing = icon_response(None);
        assert_eq!(missing.status(), 404);
        assert_eq!(missing.headers()["Cache-Control"], "no-store");
        let found = icon_response(Some(icon(vec![0xFF, 0xD8], "image/jpeg")));
        assert_eq!(found.status(), 200);
        assert_eq!(
            found.headers()["Cache-Control"],
            "public, max-age=31536000, immutable"
        );
    }

    #[test]
    fn boss_paths_try_warcraft_logs_then_the_journal_then_the_bundled_icon() {
        let dir = tempfile::tempdir().unwrap();
        let bundled = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("wcl-boss-3492.jpg"), [0xFF, 0xD8, 0x03]).unwrap();
        fs::write(
            dir.path().join("ui-ej-boss-nagasorcerer.png"),
            [0x89, b'P', b'N', b'G', 0x04],
        )
        .unwrap();
        fs::write(
            bundled.path().join("9001.png"),
            [0x89, b'P', b'N', b'G', 0x05],
        )
        .unwrap();
        fs::write(bundled.path().join("9002.jpg"), b"not an image").unwrap();
        let icons = service(dir.path());

        assert_eq!(
            icons.image("/boss/3492"),
            Some(icon(vec![0xFF, 0xD8, 0x03], "image/jpeg"))
        );
        assert!(icons.image("/boss/3379").is_none(), "no portrait table yet");
        icons.set_boss_portraits(
            BossPortraitTable::from_tsv("3379\tui-ej-boss-nagasorcerer\n").unwrap(),
        );
        assert_eq!(
            icons.image("/boss/3379"),
            Some(icon(vec![0x89, b'P', b'N', b'G', 0x04], "image/png"))
        );

        assert!(icons.image("/boss/9001").is_none(), "no bundled folder yet");
        icons.set_bundled_boss_icons(bundled.path().to_path_buf());
        assert_eq!(
            icons.image("/boss/9001"),
            Some(icon(vec![0x89, b'P', b'N', b'G', 0x05], "image/png"))
        );
        for path in [
            "/boss/9002",
            "/boss/1",
            "/boss/abc",
            "/boss/3492/1",
            "/boss/",
        ] {
            assert!(icons.image(path).is_none(), "{path}");
        }
    }
}
