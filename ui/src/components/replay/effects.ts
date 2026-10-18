import type { EffectInstance, ReplayData, ReplayDeath, ReplayTrack } from '../../api/types';
import { deathAt, groupBy, placementAt } from './playback';

/** `center.stale`: the anchor unit's position is held, so the effect fades like the unit. */
export type EffectState = {
  effect: EffectInstance;
  center: { x: number; y: number; stale: boolean } | null;
  affected: number[];
  missing: number[];
};

interface Positioned {
  track: ReplayTrack;
  /** Sorted by `t`. */
  deaths: ReplayDeath[];
}

interface EffectIndex {
  /** Sorted by start. */
  effects: EffectInstance[];
  longestMs: number;
  units: Map<number, Positioned>;
  players: number[];
}

const indexes = new WeakMap<ReplayData, EffectIndex>();

function indexEffects(data: ReplayData): EffectIndex {
  const cached = indexes.get(data);
  if (cached) return cached;
  const deaths = groupBy(data.deaths, (death) => death.actor);
  const units = new Map(data.tracks.map((track) => [track.actor, { track, deaths: (deaths.get(track.actor) ?? []).sort((a, b) => a.t - b.t) }]));
  const index = {
    effects: [...data.effects].sort((a, b) => a.startMs - b.startMs),
    longestMs: data.effects.reduce((longest, effect) => Math.max(longest, effect.endMs - effect.startMs), 0),
    units,
    players: data.units.filter((unit) => unit.kind === 'player').map((unit) => unit.actor),
  };
  indexes.set(data, index);
  return index;
}

/** Index of the first of the start-sorted `effects` that starts after `t`. */
function firstStartingAfter(effects: EffectInstance[], t: number): number {
  let lo = 0;
  let hi = effects.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (effects[mid].startMs <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function placed(index: EffectIndex, actor: number, t: number) {
  const unit = index.units.get(actor);
  return unit ? placementAt(unit.track, t, deathAt(unit.deaths, t)) : null;
}

function center(index: EffectIndex, effect: EffectInstance, t: number): EffectState['center'] {
  const { anchor } = effect;
  if (anchor === null) return null;
  if (anchor.type === 'ground') return { x: anchor.x, y: anchor.y, stale: false };
  const at = placed(index, anchor.actor, t);
  return at && { x: at.x, y: at.y, stale: at.stale };
}

function stateAt(index: EffectIndex, effect: EffectInstance, t: number): EffectState {
  const reached = new Set(effect.affected.filter((span) => span.startMs <= t && t < span.endMs).map((span) => span.actor));
  const missing =
    effect.kind === 'beneficial'
      ? index.players.filter((actor) => {
          if (reached.has(actor)) return false;
          const at = placed(index, actor, t);
          return at !== null && !at.dead;
        })
      : [];
  return { effect, center: center(index, effect, t), affected: [...reached], missing };
}

/**
 * The effects up at `t`, by start. Each counts only the players whose
 * evidence covers `t`. Missing are the positioned, living players without that evidence, for beneficial effects only.
 */
export function effectsAt(data: ReplayData, t: number): EffectState[] {
  const index = indexEffects(data);
  const { effects } = index;
  const states: EffectState[] = [];
  for (let i = firstStartingAfter(effects, t) - 1; i >= 0 && effects[i].startMs > t - index.longestMs; i--) {
    if (t < effects[i].endMs) states.push(stateAt(index, effects[i], t));
  }
  return states.reverse();
}
