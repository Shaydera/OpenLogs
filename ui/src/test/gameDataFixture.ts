import type { GameDataStatus } from '../api/types';

/** Spell icons and dungeons downloaded at local noon on Oct 11, 2026; boss portraits failed offline. */
export const gameDataFixture: GameDataStatus = {
  spellIcons: { entries: 410_805, fetchedUnixMs: new Date(2026, 9, 11, 12, 0).getTime(), error: null },
  dungeons: { entries: 87, fetchedUnixMs: new Date(2026, 9, 11, 12, 0).getTime(), error: null },
  bossPortraits: { entries: null, fetchedUnixMs: null, error: 'download failed: network error: offline' },
  refreshing: false,
};
