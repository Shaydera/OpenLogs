import type { ReplayAura, ReplayCast, ReplayDeath, ReplayHealthTrack, ReplayTrack } from '../../api/types';

export const STALE_MS = 2000;

export function groupBy<T>(items: T[], key: (item: T) => number): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

export type Placement = { x: number; y: number; facing: number; stale: boolean; dead: boolean } | null;

/** Index of the last element of the sorted `values` that is `<= t`; -1 when all are later. */
function lastAtOrBefore(values: number[], t: number): number {
  let lo = 0;
  let hi = values.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

function lerpAngle(from: number, to: number, f: number): number {
  const turn = ((((to - from) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return from + turn * f;
}

function placementOn(track: ReplayTrack, t: number): { x: number; y: number; facing: number; stale: boolean } | null {
  const i = lastAtOrBefore(track.t, t);
  if (i < 0) return null;
  const next = i + 1;
  const held = { x: track.x[i], y: track.y[i], facing: track.facing[i] };
  if (next >= track.t.length) return { ...held, stale: t - track.t[i] > STALE_MS };
  const gap = track.t[next] - track.t[i];
  if (gap > STALE_MS) return { ...held, stale: true };
  const f = (t - track.t[i]) / gap;
  return {
    x: track.x[i] + (track.x[next] - track.x[i]) * f,
    y: track.y[i] + (track.y[next] - track.y[i]) * f,
    facing: lerpAngle(track.facing[i], track.facing[next], f),
    stale: false,
  };
}

/** The latest of the sorted `deaths` at or before `t`, the one that may hold the unit in place. */
export function deathAt(deaths: ReplayDeath[], t: number): ReplayDeath | undefined {
  let death: ReplayDeath | undefined;
  for (const candidate of deaths) {
    if (candidate.t > t) break;
    death = candidate;
  }
  return death;
}

/** Where a unit is at `t`; `null` before its first sample. A dead unit stays where it died. */
export function placementAt(track: ReplayTrack, t: number, death?: ReplayDeath): Placement {
  const dead = death !== undefined && t >= death.t && (death.until === null || t < death.until);
  const placed = placementOn(track, dead ? death.t : t);
  return placed && { ...placed, stale: dead ? false : placed.stale, dead };
}

/** The cast `caster` has running at `t`, with its progress 0..1 (an instant cast is at 1). */
export function castAt(casts: ReplayCast[], caster: number, t: number): { cast: ReplayCast; progress: number } | null {
  for (const cast of casts) {
    if (cast.caster !== caster || t < cast.startMs || t > cast.endMs) continue;
    const span = cast.endMs - cast.startMs;
    return { cast, progress: span > 0 ? (t - cast.startMs) / span : 1 };
  }
  return null;
}

/** The auras on `target` that are up at `t`. */
export function aurasAt(auras: ReplayAura[], target: number, t: number): ReplayAura[] {
  return auras.filter((aura) => aura.target === target && aura.startMs <= t && t < aura.endMs);
}

/** The stack count at `t`; `null` when the aura is not up or never logged stacks. */
export function stacksAt(aura: ReplayAura, t: number): number | null {
  if (t < aura.startMs || t >= aura.endMs || aura.stacks.length === 0) return null;
  let found: number | null = null;
  for (const change of aura.stacks) {
    if (change.t > t) break;
    found = change.stacks;
  }
  return found;
}

/** The last logged health at or before `t`; `null` before the first sample. */
export function healthAt(track: ReplayHealthTrack, t: number): { current: number; max: number } | null {
  const i = lastAtOrBefore(track.t, t);
  return i < 0 ? null : { current: track.current[i], max: track.max[i] };
}

/** The target of the latest cast `caster` started at or before `t`. */
export function lastTargetAt(casts: ReplayCast[], caster: number, t: number): number | null {
  let latest: ReplayCast | null = null;
  for (const cast of casts) {
    if (cast.caster !== caster || cast.target === null || cast.startMs > t) continue;
    if (latest === null || cast.startMs >= latest.startMs) latest = cast;
  }
  return latest?.target ?? null;
}
