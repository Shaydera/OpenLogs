# OpenLogs

OpenLogs is a desktop app for analysing World of Warcraft combat logs on your own machine. Open a `WoWCombatLog-*.txt`, pick a pull and dig into it — no upload, no account, no waiting for a server.

It reads raids and Mythic+ runs, and it was built with Augmentation Evokers in mind: support damage can be shown as logged or credited back to the Evoker.

## Features

- **Pull list** grouped by boss and Mythic+ run, with kill/wipe, duration and boss HP at the end
- **Quick overview** of a pull: timeline with boss HP, raid DPS, deaths and Bloodlust; the first deaths with their killing blow; consumables; major cooldowns per player
- **Damage done, healing and damage taken** with breakdowns by ability and target, per-player and per-ability pages, and an *Augmented / Reattributed* switch for Evoker support
- **Deaths** with a recap of the last seconds: hits, heals, HP and the defensives that were (not) used
- **Buffs & debuffs, casts, interrupts & dispels and resources** tabs
- **Time ranges**: drag over the timeline or pick a phase, and every view recalculates for that range; ranges can be saved per boss
- **Compare two pulls** side by side
- Light and dark themes

## Recording logs

Enable *Advanced Combat Logging* in the game (System → Network) and start logging with `/combatlog`. The game writes the file to `World of Warcraft/_retail_/Logs`. Logs are only complete once an encounter has ended.

## Building

Requirements: Rust 1.95 or newer, Node.js 22 or newer, and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform (on Windows: WebView2 and the MSVC build tools).

```sh
npm install
npm --prefix ui install
npm run tauri dev       # run the app with hot reload
npm run tauri build     # build an installer
```

Tests:

```sh
cargo test --workspace
npm --prefix ui test
```

The workspace also contains a small CLI that lists the fights in a log:

```sh
cargo run -p openlogs-cli -- dump-fights path/to/WoWCombatLog.txt
```

## Project layout

| Path | Contents |
|---|---|
| `crates/openlogs-parser` | Streaming combat log parser |
| `crates/openlogs-index` | Encounter and Mythic+ index of a log, cached on disk |
| `crates/openlogs-analysis` | Fight model and all reports |
| `crates/openlogs-gamedata` | Spell icons, dungeon data and curated cooldown lists |
| `crates/openlogs-cli` | Command-line tools |
| `src-tauri` | Desktop app (Tauri) |
| `ui` | User interface (React, TypeScript) |
| `brand` | Logo files |

## Data sources

Spell and class icons come from the Wowhead icon CDN, dungeon and boss data from [wago.tools](https://wago.tools) and boss portraits from Warcraft Logs. Everything is downloaded on first use and cached locally. Without a network connection the app still works; missing icons show the initials of their name instead.

World of Warcraft is a trademark of Blizzard Entertainment. OpenLogs is not affiliated with Blizzard or Warcraft Logs.
