import type { ReplayAura, ReplayCast, ReplayDeath, ReplayHealthTrack, ReplayTrack, ReplayUnit } from '../../api/types';
import type { HudIndex } from './hudIndex';

export const STALE_MS = 2000;
/** The uiMapID of a sample the log placed on no known map. */
export const UNKNOWN_MAP = 0;
/** An enemy or pet with neither position nor health logged for longer than this has left: despawned, or a corpse the pull moved on from. */
const NPC_GONE_MS = 5_000;
/** A jump to a death starts this long before it, so the replay shows the run-up. */
const DEATH_LEAD_MS = 5_000;

/** Where a jump to the death at `deathMs` starts: the run-up before it, not before `floorMs`. */
export function deathJumpMs(deathMs: number, floorMs = 0): number {
  return Math.max(deathMs - DEATH_LEAD_MS, floorMs);
}

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

/** Whether `death` (from `deathAt`) holds the unit dead at `t`: from the death until it was brought back. */
export function isDeadAt(death: ReplayDeath | undefined, t: number): death is ReplayDeath {
  return death !== undefined && t >= death.t && (death.until === null || t < death.until);
}

/** Where a unit is at `t`; `null` before its first sample. A dead unit stays where it died. */
export function placementAt(track: ReplayTrack, t: number, death?: ReplayDeath): Placement {
  const dead = isDeadAt(death, t);
  const placed = placementOn(track, dead ? death.t : t);
  return placed && { ...placed, stale: dead ? false : placed.stale, dead };
}

/** The uiMapID of the sample `placementAt` places the unit by at `t` (where it died while dead); `UNKNOWN_MAP` before its first sample. */
export function floorAt(track: ReplayTrack, t: number, death?: ReplayDeath): number {
  const i = lastAtOrBefore(track.t, isDeadAt(death, t) ? death.t : t);
  return i < 0 ? UNKNOWN_MAP : track.map[i];
}

/** From when a unit counts as gone: never for a player, else `NPC_GONE_MS` after its last logged position or health. */
export function goneAfterMs(kind: ReplayUnit['kind'], track: ReplayTrack | undefined, health: ReplayHealthTrack | undefined): number {
  if (kind === 'player') return Infinity;
  return Math.max(track?.t.at(-1) ?? -Infinity, health?.t.at(-1) ?? -Infinity) + NPC_GONE_MS;
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

/** The latest primary-power sample of `actor` at or before `t`; `null` before the first one or without any. */
export function powerAt(hud: HudIndex, actor: number, t: number): { powerType: number; current: number; max: number } | null {
  const track = hud.power.get(actor);
  const i = track ? lastAtOrBefore(track.t, t) : -1;
  return track && i >= 0 ? { powerType: track.powerType, current: track.current[i], max: track.max[i] } : null;
}

/** The unit `actor` targets at `t`: the latest change at or before it. */
export function targetAt(hud: HudIndex, actor: number, t: number): number | null {
  const track = hud.targets.get(actor);
  const i = track ? lastAtOrBefore(track.t, t) : -1;
  return track && i >= 0 ? track.target[i] : null;
}
