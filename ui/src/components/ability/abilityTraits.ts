import type { AbilityDetail } from '../../api/types';
import { t } from '../../i18n/i18n';

/** Index of the last cast at or before `time`, or -1. */
function castBefore(casts: number[], time: number): number {
  let low = 0;
  let high = casts.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (casts[middle] <= time) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/**
 * Distinct targets per cast on average, from direct hits only (a HoT's or DoT's ticks of earlier casts
 * on other targets would fill every window): the hits between one cast and the next form a window
 * (hits before the first cast are left out); without casts (procs) the hits of one timestamp do.
 */
export function targetsPerWindow(detail: Pick<AbilityDetail, 'casts' | 'hits'>): number {
  const casts = [...detail.casts].sort((a, b) => a - b);
  const windows = new Map<number, Set<number>>();
  for (const hit of detail.hits) {
    if (hit.periodic) continue;
    const key = casts.length > 0 ? castBefore(casts, hit.t) : hit.t;
    if (casts.length > 0 && key < 0) continue;
    const targets = windows.get(key) ?? new Set<number>();
    targets.add(hit.target);
    windows.set(key, targets);
  }
  if (windows.size === 0) return 0;
  let sum = 0;
  windows.forEach((targets) => (sum += targets.size));
  return sum / windows.size;
}

/** The ability's description fact: "Direct damage, cleaves", "Periodic healing". */
export function abilityTraits(detail: AbilityDetail): string {
  const healing = detail.metric === 'healing';
  const periodic = detail.hits.filter((h) => h.periodic).length * 2 > detail.hits.length;
  const kind = t(
    periodic
      ? healing
        ? 'ability.trait.periodicHealing'
        : 'ability.trait.periodic'
      : healing
        ? 'ability.trait.directHealing'
        : 'ability.trait.direct',
  );
  // Mostly periodic abilities (HoTs, DoTs) never cleave.
  return !periodic && targetsPerWindow(detail) >= 1.5 ? t('ability.trait.cleaves', { kind }) : kind;
}

/** The KPI strip's "targets per cast": direct hits per cast; `null` without casts or direct hits. */
export function directHitsPerCast(detail: Pick<AbilityDetail, 'casts' | 'hits'>): number | null {
  const direct = detail.hits.filter((h) => !h.periodic).length;
  return detail.casts.length > 0 && direct > 0 ? direct / detail.casts.length : null;
}
