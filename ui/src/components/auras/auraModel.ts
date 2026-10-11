import type { AuraScope, AurasReport, PlayerRef } from '../../api/types';
import { classColor } from '../overview/players';

export type AuraRow = AurasReport['rows'][number];
export type AuraSort = 'uptime' | 'targets' | 'applications';

/** Rows shown before "Show all". */
export const AURA_ROWS = 25;

/**
 * The uptime bar's colour: the class colour of the one player who applied it, neutral for several or
 * none, and the damage-taken colour for debuffs on players.
 */
export function auraColour(row: AuraRow, scope: AuraScope, roster: Map<number, PlayerRef>): string {
  if (scope === 'debuffs_on_players') return 'var(--wipe)';
  const only = row.sources.length === 1 ? roster.get(row.sources[0]) : undefined;
  return only?.classToken ? classColor(only.classToken) : 'var(--faint)';
}

/** Rows by the chosen column, largest first; ties by name. */
export function sortAuras(rows: AuraRow[], sort: AuraSort, name: (id: number) => string): AuraRow[] {
  const key = (row: AuraRow) => (sort === 'uptime' ? row.uptime : sort === 'targets' ? row.targets.length : row.applications);
  return [...rows].sort((a, b) => key(b) - key(a) || name(a.spellId).localeCompare(name(b.spellId)));
}
