export type MarkerSymbol = 'square' | 'triangle' | 'diamond' | 'cross' | 'star' | 'circle' | 'moon' | 'skull';
export type MarkerLook = { symbol: MarkerSymbol; colorVar: string };

export const markerColorVar = (symbol: MarkerSymbol) => `--marker-${symbol}`;
const look = (symbol: MarkerSymbol): MarkerLook => ({ symbol, colorVar: markerColorVar(symbol) });

/** The logged world marker number `n` is the in-game slot `n + 1` (slot 1 is the blue square). */
export const WORLD_MARKERS: Record<number, MarkerLook> = {
  0: look('square'),
  1: look('triangle'),
  2: look('diamond'),
  3: look('cross'),
  4: look('star'),
  5: look('circle'),
  6: look('moon'),
  7: look('skull'),
};

/** A unit's raid target icon by its index 1..8, the lowest set bit of the logged raid flags. */
export const RAID_TARGET_MARKERS: Record<number, MarkerLook> = {
  1: look('star'),
  2: look('circle'),
  3: look('diamond'),
  4: look('triangle'),
  5: look('moon'),
  6: look('square'),
  7: look('cross'),
  8: look('skull'),
};

export const MARKER_SYMBOLS: readonly MarkerSymbol[] = ['square', 'triangle', 'diamond', 'cross', 'star', 'circle', 'moon', 'skull'];
