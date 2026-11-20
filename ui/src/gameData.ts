import type { DataGame, MapArtTable } from './api/types';
import { currentDataGame, subscribeCurrentGame } from './currentGame';

/** Game data shipped next to the app in `game-data/`, written by `openlogs-cli export-game-data`. */
export interface GameDataManifest {
  /** When the tables were downloaded from wago.tools (a real instant, Unix ms). */
  fetchedUnixMs: number;
  spellIcons: number;
  /** Absent in an export made before channel spells were exported. */
  channelSpells?: number;
  /** Absent in an export made before class spells were exported. */
  spellClasses?: number;
  dungeons: number;
  bossPortraits: number;
  /** Absent in an export made before map art was exported. */
  mapArt?: number;
  /** The spell tables of the Forever build, in `forever/`; absent in an export made before them. */
  forever?: { build: string; spellIcons: number; channelSpells: number; spellClasses: number; talentTrees?: number };
}

/** Spell ID → icon name, as sorted parallel arrays. */
export interface SpellIcons {
  ids: Uint32Array;
  icons: Uint32Array;
  names: string[];
}

export interface IconTables {
  /** Of the open log's game. */
  spells: SpellIcons | null;
  /** Encounter ID → Encounter Journal portrait name. */
  portraits: Record<string, string> | null;
  mapArt: MapArtTable | null;
}

const DIRECTORY = `${import.meta.env.BASE_URL}game-data/`;

/** `null` when the app ships without the file; a dev server answers missing files with its page. */
async function fetchText(file: string): Promise<string | null> {
  const response = await fetch(`${DIRECTORY}${file}`);
  if (response.status === 404 || (response.ok && !response.headers.get('content-type')?.includes('json'))) return null;
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.text();
}

let manifestRequest: Promise<GameDataManifest | null> | null = null;

/** `null` without game data. A failed request is not remembered, so the next call tries again. */
export function gameDataManifest(): Promise<GameDataManifest | null> {
  manifestRequest ??= fetchText('manifest.json').then((text) => (text === null ? null : (JSON.parse(text) as GameDataManifest)));
  return manifestRequest.catch(() => {
    manifestRequest = null;
    return null;
  });
}

/** A table named by the manifest; the manifest's time keeps browser caches from serving an older export. */
async function tableText(file: string, game: DataGame = 'retail'): Promise<string | null> {
  const manifest = await gameDataManifest();
  if (!manifest || (game === 'forever' && !manifest.forever)) return null;
  const path = game === 'forever' ? `forever/${file}` : file;
  return fetchText(`${path}?v=${manifest.fetchedUnixMs}`);
}

/** The Mythic+ dungeon table for the engine. */
export const dungeonsJson = (): Promise<string | null> => tableText('dungeons.json').catch(() => null);

/** The spells the game channels, for the engine. */
export const channelSpellsJson = (game: DataGame): Promise<string | null> => tableText('channel-spells.json', game).catch(() => null);

/** The class and crowd-control spells, for the engine. */
export const spellClassesJson = (game: DataGame): Promise<string | null> => tableText('spell-classes.json', game).catch(() => null);

/** The talent trees a Forever player's spec comes from, for the engine; no other game has them. */
export async function talentTreesJson(game: DataGame): Promise<string | null> {
  const manifest = await gameDataManifest();
  if (game !== 'forever' || !manifest?.forever?.talentTrees) return null;
  return tableText('talent-trees.json', game).catch(() => null);
}

/** Decodes the export's spell IDs, stored as differences to the previous ID. */
export function decodeSpellIcons(table: { ids: number[]; icons: number[]; names: string[] }): SpellIcons {
  const ids = new Uint32Array(table.ids.length);
  let id = 0;
  table.ids.forEach((delta, i) => {
    id += delta;
    ids[i] = id;
  });
  return { ids, icons: Uint32Array.from(table.icons), names: table.names };
}

export function spellIconName(spells: SpellIcons, spellId: number): string | null {
  let low = 0;
  let high = spells.ids.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const id = spells.ids[middle];
    if (id === spellId) return spells.names[spells.icons[middle]] ?? null;
    if (id < spellId) low = middle + 1;
    else high = middle - 1;
  }
  return null;
}

/** A table that could not be loaded is asked for again after this long. */
const RETRY_MS = 30_000;

const spellIcons: Record<DataGame, SpellIcons | null> = { retail: null, forever: null };
let portraits: IconTables['portraits'] = null;
let mapArt: IconTables['mapArt'] = null;
let tables: IconTables = { spells: null, portraits: null, mapArt: null };
const listeners = new Set<() => void>();
/** By table, and for spell icons by game too, such as `spells:forever`. */
const nextAttempt = new Map<string, number>();

function publish() {
  tables = { spells: spellIcons[currentDataGame()], portraits, mapArt };
  listeners.forEach((listener) => listener());
}

function loadTable(table: string, loaded: boolean, read: () => Promise<string | null>, keep: (text: string) => void) {
  if (loaded || Date.now() < (nextAttempt.get(table) ?? 0)) return;
  nextAttempt.set(table, Number.POSITIVE_INFINITY);
  void read()
    .then((text) => {
      if (text === null) throw new Error(`${table} is missing`);
      keep(text);
      publish();
    })
    .catch(() => nextAttempt.set(table, Date.now() + RETRY_MS));
}

/** Components re-render through `subscribeIconTables` when the tables arrive or the open log's game changes. */
export function loadIconTables() {
  const game = currentDataGame();
  loadTable(`spells:${game}`, spellIcons[game] !== null, () => tableText('spell-icons.json', game), (text) => {
    spellIcons[game] = decodeSpellIcons(JSON.parse(text));
  });
  loadTable('portraits', portraits !== null, () => tableText('boss-portraits.json'), (text) => {
    portraits = JSON.parse(text);
  });
  loadTable('mapArt', mapArt !== null, () => tableText('map-art.json'), (text) => {
    mapArt = JSON.parse(text);
  });
}

subscribeCurrentGame(() => {
  publish();
  // The tables load on first use (`useIconSrc`); before that, a game change has nothing to load for.
  if (listeners.size > 0) loadIconTables();
});

export const iconTables = () => tables;

export function subscribeIconTables(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
