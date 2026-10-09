import type { Phase, UnitLife } from '../../api/types';
import { formatEventTime, formatSeconds } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { band } from '../player/chartGeometry';

/** Killed units that lived at least this long are highlighted. */
const LONG_LIFE_MS = 15_000;

/** A wave cleared later than this after its first spawn is marked. */
export const SLOW_CLEAR_MS = 20_000;

interface Lane {
  actor: number;
  leftPct: number;
  widthPct: number;
  kind: 'short' | 'long' | 'alive';
  title: string;
}

export function lifetimeLanes(units: UnitLife[], startMs: number, endMs: number, unit: string): Lane[] {
  return units.flatMap((entry, i) => {
    const end = entry.death ?? entry.lastHit;
    const pos = band(entry.firstHit, Math.max(end, entry.firstHit + 1), startMs, endMs);
    if (!pos) return [];
    const life = end - entry.firstHit;
    const kind = entry.death === null ? 'alive' : life >= LONG_LIFE_MS ? 'long' : 'short';
    const to = entry.death === null ? t('target.despawned', { time: formatEventTime(end) }) : formatEventTime(end);
    const title = t('target.laneTitle', {
      unit,
      n: String(i + 1),
      from: formatEventTime(entry.firstHit),
      to,
      duration: formatSeconds(life),
    });
    return [{ actor: entry.actor, ...pos, kind, title }];
  });
}

/** The pull's intermissions inside the range, hatched behind the lanes. */
export function intermissionBands(phases: Phase[], startMs: number, endMs: number): { leftPct: number; widthPct: number }[] {
  return phases.flatMap((phase) => {
    if (phase.kind !== 'intermission') return [];
    const at = band(phase.startMs, phase.endMs, startMs, endMs);
    return at ? [at] : [];
  });
}
