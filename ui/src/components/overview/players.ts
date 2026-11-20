import type { PlayerRef, QuickOverview, Role } from '../../api/types';
import { currentGame } from '../../currentGame';
import { formatEventTime } from '../../i18n/format';
import { t } from '../../i18n/i18n';

export const ROLE_ORDER: (Role | null)[] = ['tank', 'healer', 'damage', null];

/**
 * A player's name from the logged `Name-Realm-Region`: "Faelan-Emberfall-EU" → "Faelan". A Forever name
 * may itself contain `-`: "Ravel-Ashwood-Normal-EU" → "Ravel Ashwood". Keep in step with the service's
 * `GameFlavor::player_name`.
 */
export function shortName(name: string): string {
  const parts = name.split('-');
  return currentGame()?.kind === 'forever' && parts.length > 2 ? parts.slice(0, -2).join(' ') : parts[0];
}

export function classColor(token: string | null): string {
  return token ? `var(--class-${token.toLowerCase()})` : 'var(--text)';
}

export function playerIndex(overview: QuickOverview): Map<number, PlayerRef> {
  return new Map(overview.players.map((player) => [player.actorId, player]));
}

export function spellName(source: Pick<QuickOverview, 'spells'>, spellId: number): string {
  if (spellId === 0) return t('overview.melee');
  return source.spells[String(spellId)]?.name ?? t('overview.unknownSpell', { id: spellId });
}

export function roleTitle(role: Role | null): string {
  return role ? t(`role.${role}`) : t('role.unknown');
}

/** When a consumable or defensive was used: `m:ss`, or "pre-pull" before the pull. */
export function usedAtLabel(ms: number): string {
  return ms < 0 ? t('consumables.prePull') : formatEventTime(ms);
}

/**
 * The players by role (tanks, healers, DPS, then "Unknown spec"), alphabetical within a role. A player
 * without `COMBATANT_INFO` has no spec, class or role, so they get the unknown group rather than a guess.
 */
export function sortedRoster(overview: QuickOverview): PlayerRef[] {
  return [...overview.players].sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || shortName(a.name).localeCompare(shortName(b.name)),
  );
}
