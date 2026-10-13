<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/openlogs-wordmark-on-dark.svg">
    <img src="brand/openlogs-wordmark-on-light.svg" alt="OpenLogs" width="440">
  </picture>
</h1>

<p align="center">World of Warcraft combat logs, analysed on your own machine</p>

OpenLogs analyses World of Warcraft combat logs on your own machine, in the browser or as a desktop app. Open a `WoWCombatLog-*.txt`, pick a pull and dig into it — no upload, no account, no waiting for a server. The log never leaves your computer: even the website reads and analyses it locally.

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

## Website and desktop app

Both run the same app: the analysis is written in Rust and runs as WebAssembly in a background worker. A log is indexed once and the index is stored in the browser, so opening it again is instant.

- **Website**: works in current Chrome, Edge and Firefox. In Chrome and Edge the recent list reopens a log with one click (the browser may ask to allow reading it); other browsers ask you to choose the file again.
- **Desktop app**: the same app in its own window (Tauri), installable and usable offline.

## Recording logs

Enable *Advanced Combat Logging* in the game (System → Network) and start logging with `/combatlog`. The game writes the file to `World of Warcraft/_retail_/Logs`. Logs are only complete once an encounter has ended.

## Building

Requirements: Rust 1.95 or newer with the `wasm32-unknown-unknown` target, [`wasm-bindgen-cli`](https://github.com/wasm-bindgen/wasm-bindgen) in the version `crates/openlogs-wasm/Cargo.toml` pins, and Node.js 22 or newer. The desktop app also needs the [Tauri prerequisites](https://tauri.app/start/prerequisites/) (on Windows: WebView2 and the MSVC build tools).

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129
npm install
npm --prefix ui install
npm --prefix ui run gamedata   # download spell icons, dungeons and boss portraits
```

Website:

```sh
npm --prefix ui run dev        # run with hot reload on http://localhost:5173
npm --prefix ui run build      # static site in ui/dist
```

Desktop app:

```sh
npm run tauri dev              # run the app with hot reload
npm run tauri build            # build an installer
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
| `crates/openlogs-index` | Encounter and Mythic+ index of a log |
| `crates/openlogs-analysis` | Fight model and all reports |
| `crates/openlogs-service` | The reports in the shape the UI shows |
| `crates/openlogs-wasm` | The engine the app runs as WebAssembly |
| `crates/openlogs-gamedata` | Spell icons, dungeon data and curated cooldown lists |
| `crates/openlogs-cli` | Command-line tools, including the game data export |
| `src-tauri` | Desktop app window (Tauri) |
| `ui` | User interface (React, TypeScript) |
| `brand` | Logo files |

## Data sources

Spell, class and boss images come from the Wowhead CDN; spell icon names, dungeon and boss data from [wago.tools](https://wago.tools). The game data is exported with each release (`npm --prefix ui run gamedata`) and ships with the app. Without a network connection the app still works; missing images show the initials of their name instead.

World of Warcraft is a trademark of Blizzard Entertainment. OpenLogs is not affiliated with Blizzard or Warcraft Logs.

## Contributing

Pull requests go against `development`; `main` holds the latest release. See [CONTRIBUTING.md](CONTRIBUTING.md), including the contributor license agreement.

## License

Copyright 2026 Shaydera

OpenLogs is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. It comes without any warranty; see [LICENSE](LICENSE) for the full terms. If you run a modified version for others over a network, you have to offer them its source code.

The license covers OpenLogs itself. Third-party components such as the fonts keep their own licenses, and World of Warcraft game data and images belong to Blizzard Entertainment.
