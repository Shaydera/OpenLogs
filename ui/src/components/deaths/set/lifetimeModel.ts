import type { DeathRecap, SetDeathsPull } from '../../../api/types';

/** A player's pull: the share of it they stayed alive for, `firstDeathMs` `null` when they survived it. */
export interface LifetimeCell {
  pct: number;
  firstDeathMs: number | null;
}

export interface LifetimeRow {
  player: number;
  /** One per pull in set order; `null` for a pull the player was not in. */
  cells: (LifetimeCell | null)[];
  pulls: number;
  /** Mean of the player's pull shares. */
  avgPct: number;
  /** Time alive until the first death over the summed duration of the player's pulls. */
  avgTimePct: number;
}

export const LIFE_BANDS = [50, 75, 90, 100] as const;
export type LifeBand = (typeof LIFE_BANDS)[number];

const MIN_PULL_OPTIONS = [1, 2, 3];

const shareOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 100);

/** The players of any pull's lifetime, lowest average first, then by name. */
export function lifetimeRows(pulls: Pick<SetDeathsPull, 'durationMs' | 'lifetime'>[], nameOf: (player: number) => string): LifetimeRow[] {
  const lives = pulls.map((pull) => new Map(pull.lifetime.map((life) => [life.player, life.firstDeathMs])));
  const players = [...new Set(pulls.flatMap((pull) => pull.lifetime.map((life) => life.player)))];
  const rows = players.map((player): LifetimeRow => {
    let alive = 0;
    let duration = 0;
    let pctSum = 0;
    const cells = pulls.map((pull, i): LifetimeCell | null => {
      if (!lives[i].has(player)) return null;
      const firstDeathMs = lives[i].get(player) ?? null;
      const aliveMs = Math.min(Math.max(firstDeathMs ?? pull.durationMs, 0), pull.durationMs);
      const pct = shareOf(aliveMs, pull.durationMs);
      alive += aliveMs;
      duration += pull.durationMs;
      pctSum += pct;
      return { pct, firstDeathMs };
    });
    const count = cells.filter((cell) => cell !== null).length;
    return { player, cells, pulls: count, avgPct: pctSum / count, avgTimePct: shareOf(alive, duration) };
  });
  return rows.sort((a, b) => a.avgPct - b.avgPct || nameOf(a.player).localeCompare(nameOf(b.player)));
}

/** The band of a pull share; `null` at 100 % (survived). */
export function lifeBand(pct: number): LifeBand | null {
  return LIFE_BANDS.find((limit) => pct < limit) ?? null;
}

/** "In ≥ n pulls" choices, only as far as the set has pulls. */
export function minPullOptions(pullCount: number): number[] {
  return MIN_PULL_OPTIONS.filter((min) => min <= Math.max(1, pullCount));
}

/** From the last full HP (or the life's start) to the death. */
export function deathWindowMs(death: Pick<DeathRecap, 't' | 'windowStartMs'>): number {
  return Math.max(0, death.t - death.windowStartMs);
}

export function medianMs(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Windows from the pull start (no advanced logging) can run for minutes: longer scales get wider ticks. */
const windowStepMs = (ms: number) => (ms <= 60_000 ? 10_000 : ms <= 180_000 ? 30_000 : 60_000);

/** The death-window chart's ceiling: the longest window rounded up to the next tick, at least 10 s. */
export function windowScaleMs(windows: number[]): number {
  const longest = Math.max(0, ...windows);
  const step = windowStepMs(longest);
  return Math.max(step, Math.ceil(longest / step) * step);
}

/** The y ticks of the death-window chart from 0 to the ceiling. */
export function windowTicksMs(scaleMs: number): number[] {
  const step = windowStepMs(scaleMs);
  return Array.from({ length: Math.floor(scaleMs / step) + 1 }, (_, i) => i * step);
}
