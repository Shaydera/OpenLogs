import type { AuraKind, AuraRow, PlayerRef, Side } from '../../api/types';
import { classColor } from '../overview/players';

export type AuraSort = 'uptime' | 'targets' | 'applications';

/** Rows shown before "Show all". */
export const AURA_ROWS = 25;

/**
 * An uptime bar's colour: the class colour of the one player who applied it, neutral for several or
 * none, and the damage-taken colour for debuffs on friendlies.
 */
export function auraColour(sources: number[], kind: AuraKind, side: Side, roster: Map<number, PlayerRef>): string {
  if (kind === 'debuffs' && side === 'friendly') return 'var(--wipe)';
  const only = sources.length === 1 ? roster.get(sources[0]) : undefined;
  return only?.classToken ? classColor(only.classToken) : 'var(--faint)';
}

/** Rows by the chosen column, largest first; ties by name. `targets` counts the lanes. */
export function sortAuras(rows: AuraRow[], sort: AuraSort, name: (row: AuraRow) => string): AuraRow[] {
  const key = (row: AuraRow) => (sort === 'uptime' ? row.uptime : sort === 'targets' ? row.lanes.length : row.applications);
  return [...rows].sort((a, b) => key(b) - key(a) || name(a).localeCompare(name(b)));
}
