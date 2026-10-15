import type { Role } from '../../api/types';
import { t } from '../../i18n/i18n';
import { ROLE_ORDER } from '../overview/players';

export interface UnitFacts {
  boss: boolean;
  player: boolean;
  role: Role | null;
  /** What the unit is ordered by: its label with its number. */
  label: string;
  /** What the unit is grouped by: the name the log gives it. */
  name: string;
}

/** The bosses first, then the players by role, then by label with numbers in order. */
export function orderUnits<T>(units: readonly T[], facts: (unit: T) => UnitFacts): T[] {
  return units
    .map((unit) => ({ unit, ...facts(unit) }))
    .sort(
      (a, b) =>
        Number(b.boss) - Number(a.boss) || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.label.localeCompare(b.label, undefined, { numeric: true }),
    )
    .map(({ unit }) => unit);
}

/** The units that share a name with another, each to the members of its name in order; bosses and players stand alone. */
export function nameGroups<T>(units: readonly T[], facts: (unit: T) => Pick<UnitFacts, 'boss' | 'player' | 'name'>): Map<T, T[]> {
  const byName = new Map<string, T[]>();
  for (const unit of units) {
    const { boss, player, name } = facts(unit);
    if (boss || player) continue;
    const members = byName.get(name);
    if (members) members.push(unit);
    else byName.set(name, [unit]);
  }
  const groups = new Map<T, T[]>();
  for (const members of byName.values()) if (members.length > 1) for (const unit of members) groups.set(unit, members);
  return groups;
}

/** A group member's label: its number; none for a unit without one. */
export const memberLabel = (number: number | null): string | undefined => (number === null ? undefined : t('scope.instanceNumber', { number }));

export function toggled(open: ReadonlySet<string>, name: string): ReadonlySet<string> {
  const next = new Set(open);
  if (!next.delete(name)) next.add(name);
  return next;
}
