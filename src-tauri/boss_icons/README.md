# Bundled boss icons

Last image source for a boss portrait, used when neither Warcraft Logs
(`assets.rpglogs.com/img/warcraft/bosses/<id>-icon.jpg`) nor the Encounter Journal (wago.tools + zamimg)
has one.

- File name: the encounter ID of `ENCOUNTER_START` (= `DungeonEncounter.ID`), e.g. `3492.jpg` or `3492.png`.
- Format: JPEG or PNG, square, at least 56×56 px (shown at 40 px in the pull list, 56 px in the fight header).
- The folder is bundled as a Tauri resource (`bundle.resources` in `tauri.conf.json`); this README is the
  only file until icons are supplied.
