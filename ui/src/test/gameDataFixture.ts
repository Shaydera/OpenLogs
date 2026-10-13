import type { GameDataManifest } from '../gameData';

/** Game data exported at local noon on Oct 11, 2026. */
export const gameDataFixture: GameDataManifest = {
  fetchedUnixMs: new Date(2026, 9, 11, 12, 0).getTime(),
  spellIcons: 410_805,
  dungeons: 87,
  bossPortraits: 1_083,
};
