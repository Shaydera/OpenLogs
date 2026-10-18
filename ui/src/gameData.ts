import type { MapArtTable } from './api/types';

/** Game data shipped next to the app in `game-data/`, written by `openlogs-cli export-game-data`. */
export interface GameDataManifest {
  /** When the tables were downloaded from wago.tools (a real instant, Unix ms). */
  fetchedUnixMs: number;
  spellIcons: number;
  /** Absent in an export made before channel spells were exported. */
  channelSpells?: number;
  dungeons: number;
  bossPortraits: number;
  /** Absent in an export made before map art was exported. */
  mapArt?: number;
}

/** Spell ID → icon name, as sorted parallel arrays. */
export interface SpellIcons {
  ids: Uint32Array;
  icons: Uint32Array;
  names: string[];
}

export interface IconTables {
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
async function tableText(file: string): Promise<string | null> {
  const manifest = await gameDataManifest();
  return manifest ? fetchText(`${file}?v=${manifest.fetchedUnixMs}`) : null;
}

/** The Mythic+ dungeon table for the engine. */
export const dungeonsJson = (): Promise<string | null> => tableText('dungeons.json').catch(() => null);

/** The spells the game channels, for the engine. */
export const channelSpellsJson = (): Promise<string | null> => tableText('channel-spells.json').catch(() => null);

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

let tables: IconTables = { spells: null, portraits: null, mapArt: null };
const listeners = new Set<() => void>();
const nextAttempt: Record<keyof IconTables, number> = { spells: 0, portraits: 0, mapArt: 0 };

function loadTable<K extends keyof IconTables>(key: K, file: string, parse: (text: string) => IconTables[K]) {
  if (tables[key] !== null || Date.now() < nextAttempt[key]) return;
  nextAttempt[key] = Number.POSITIVE_INFINITY;
  void tableText(file)
    .then((text) => {
      if (text === null) throw new Error(`${file} is missing`);
      tables = { ...tables, [key]: parse(text) };
      listeners.forEach((listener) => listener());
    })
    .catch(() => (nextAttempt[key] = Date.now() + RETRY_MS));
}

/** Components re-render through `subscribeIconTables` when the tables arrive. */
export function loadIconTables() {
  loadTable('spells', 'spell-icons.json', (text) => decodeSpellIcons(JSON.parse(text)));
  loadTable('portraits', 'boss-portraits.json', (text) => JSON.parse(text));
  loadTable('mapArt', 'map-art.json', (text) => JSON.parse(text));
}

export const iconTables = () => tables;

export function subscribeIconTables(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
