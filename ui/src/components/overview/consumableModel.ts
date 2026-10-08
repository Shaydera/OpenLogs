import type { ConsumableKind, QuickOverview } from '../../api/types';
import type { MessageKey } from '../../i18n/i18n';
import { spellName } from './players';

export interface ConsumableColumn {
  kind: ConsumableKind;
  label: MessageKey;
  /** Shown only when someone used one. */
  onlyWhenUsed?: boolean;
}

const COLUMNS: ConsumableColumn[] = [
  { kind: 'combat_potion', label: 'consumables.combatPotion' },
  { kind: 'healthstone', label: 'consumables.healthstone' },
  { kind: 'health_potion', label: 'consumables.healthPotion' },
  // Not expected of every player, so never "missing"; shown only when someone drank one.
  { kind: 'mana_potion', label: 'consumables.manaPotion', onlyWhenUsed: true },
];

export function consumableColumns(overview: QuickOverview): ConsumableColumn[] {
  return COLUMNS.filter((column) => !column.onlyWhenUsed || overview.consumables.some((u) => u.kind === column.kind));
}

export interface LegendItem {
  kind: ConsumableKind;
  spellId: number;
  name: string;
}

/**
 * The item legend: per shown column the item used most often (on a tie the first in
 * the backend's log order). Columns nobody used have no entry.
 */
export function consumableLegend(overview: QuickOverview, columns: ConsumableColumn[]): LegendItem[] {
  return columns.flatMap((column) => {
    const uses = overview.consumables.filter((u) => u.kind === column.kind);
    if (uses.length === 0) return [];
    const counts = new Map<number, number>();
    for (const use of uses) counts.set(use.spellId, (counts.get(use.spellId) ?? 0) + 1);
    let best = uses[0].spellId;
    for (const [spellId, n] of counts) if (n > (counts.get(best) ?? 0)) best = spellId;
    return [{ kind: column.kind, spellId: best, name: spellName(overview, best) }];
  });
}

/** The roster split into two columns; the first gets the extra player (23 → 12 + 11). */
export function rosterHalves<T>(roster: T[]): [T[], T[]] {
  const cut = Math.ceil(roster.length / 2);
  return [roster.slice(0, cut), roster.slice(cut)];
}
