use std::sync::Mutex;

use openlogs_gamedata::{
    DownloadError, Fetch, FetchError, WAGO_LATEST_BUILDS_URL, download_forever_tables,
};

const SPELL_MISC: &str =
    "ID,Attributes_1,DifficultyID,SpellIconFileDataID,SpellID\n1,0,0,132276,5487\n";
const MANIFEST: &str =
    "ID,FilePath,FileName\n132276,Interface\\Icons\\,Ability_Racial_BearForm.blp\n";
const SPELL_CLASS_OPTIONS: &str = "ID,SpellID,SpellClassSet\n1,5487,7\n";
const SPELL_EFFECT: &str = "ID,EffectAura,SpellID\n1,0,5487\n";

/// Answers wago.tools requests from fixed tables and records every URL asked for.
struct FakeWago {
    latest_builds: &'static str,
    asked: Mutex<Vec<String>>,
}

impl FakeWago {
    fn new(latest_builds: &'static str) -> Self {
        Self {
            latest_builds,
            asked: Mutex::new(Vec::new()),
        }
    }
}

impl Fetch for FakeWago {
    fn get(&self, url: &str) -> Result<Vec<u8>, FetchError> {
        self.asked.lock().unwrap().push(url.to_string());
        let table = url
            .strip_prefix("https://wago.tools/db2/")
            .and_then(|rest| rest.split('/').next());
        let body = match table {
            None if url == WAGO_LATEST_BUILDS_URL => self.latest_builds,
            Some("SpellMisc") => SPELL_MISC,
            Some("ManifestInterfaceData") => MANIFEST,
            Some("SpellClassOptions") => SPELL_CLASS_OPTIONS,
            Some("SpellEffect") => SPELL_EFFECT,
            _ => return Err(FetchError::Status(404)),
        };
        Ok(body.as_bytes().to_vec())
    }
}

#[test]
fn forever_tables_come_from_the_latest_forever_build() {
    let wago =
        FakeWago::new(r#"{"wow":{"version":"12.1.5.70961"},"wowf":{"version":"1.60.1.70959"}}"#);

    let tables = download_forever_tables(&wago).unwrap();

    assert_eq!(tables.build, "1.60.1.70959");
    assert_eq!(
        tables.spells.icons.icon(5487),
        Some("ability_racial_bearform")
    );
    assert!(tables.classes.is_class_spell(5487));
    let asked = wago.asked.lock().unwrap();
    let tables_asked: Vec<&String> = asked
        .iter()
        .filter(|url| url.as_str() != WAGO_LATEST_BUILDS_URL)
        .collect();
    assert_eq!(tables_asked.len(), 4, "asked {asked:?}");
    for url in tables_asked {
        assert!(url.ends_with("/csv?build=1.60.1.70959"), "asked {url}");
    }
}

#[test]
fn a_latest_builds_answer_without_forever_is_an_error() {
    let wago = FakeWago::new(r#"{"wow":{"version":"12.1.5.70961"}}"#);

    let err = download_forever_tables(&wago).err().unwrap();

    assert!(matches!(err, DownloadError::NoBuild("wowf")), "got {err}");
}
