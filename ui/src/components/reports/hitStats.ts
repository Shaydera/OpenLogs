import type { BreakdownRow } from '../../api/types';

export const directHits = (row: BreakdownRow): number => row.hits - row.ticks;

export const missCount = (row: BreakdownRow): number => row.misses.reduce((sum, miss) => sum + miss.count, 0);

/** The average direct hit and tick; `null` for the kind the row has none of. */
export function averageHits(row: BreakdownRow): { direct: number | null; tick: number | null } {
  const direct = directHits(row);
  return {
    direct: direct > 0 ? (row.hitAmount - row.tickAmount) / direct : null,
    tick: row.ticks > 0 ? row.tickAmount / row.ticks : null,
  };
}

/** The share of attacks that missed, of hits and misses together; `null` without misses. */
export function missShare(row: BreakdownRow): number | null {
  const misses = missCount(row);
  return misses > 0 ? misses / (row.hits + misses) : null;
}

/** `10 (84)`: direct first, ticks in brackets; a row with only one kind shows that kind alone. */
export function directAndTick(direct: string | null, tick: string | null): string | null {
  if (direct !== null && tick !== null) return `${direct} (${tick})`;
  return direct ?? tick;
}
