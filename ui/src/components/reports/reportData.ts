import type { PlayerRef } from '../../api/types';
import { namedIcon, spellIcon } from '../../icons';
import { t } from '../../i18n/i18n';

export type SpellNames = Record<string, { name: string }>;

export function rosterIndex(roster: PlayerRef[]): Map<number, PlayerRef> {
  return new Map(roster.map((player) => [player.actorId, player]));
}

/** Spell name of a hit; world damage (falling, lava, …) has no spell. */
export function hitName(hit: { spellId: number; environmental: boolean }, name: (spellId: number) => string): string {
  return hit.environmental ? t('deaths.environmentalDamage') : name(hit.spellId);
}

/**
 * Who dealt a hit. The log names no source for world damage, and also for some damage over time
 * whose caster is gone; only the former is "Environment".
 */
export function sourceLabel(hit: { sourceName: string | null; environmental: boolean }): string {
  return hit.sourceName ?? t(hit.environmental ? 'deaths.environment' : 'deaths.unknownSource');
}

export function reportSpellName(spells: SpellNames, spellId: number): string {
  if (spellId === 0) return t('overview.melee');
  return spells[String(spellId)]?.name ?? t('overview.unknownSpell', { id: spellId });
}

/** Named icons for hits without a spell icon of their own. */
const MELEE_ICON = 'ability_meleedamage';
const ENVIRONMENT_ICON = 'spell_nature_earthquake';

/** Icon of a hit: melee swings and world damage (both spell 0) get named icons. */
export function hitIcon(hit: { spellId: number; environmental: boolean }): string {
  if (hit.environmental) return namedIcon(ENVIRONMENT_ICON);
  return hit.spellId === 0 ? namedIcon(MELEE_ICON) : spellIcon(hit.spellId);
}

/**
 * A bar's CSS width to one decimal, so a tiny share (0.05M of 142M) is `0%` and draws no hairline
 * sliver.
 */
export function barWidth(pct: number): string {
  // A CSS value, not display text: rounded to one decimal without a locale.
  return `${Math.round(pct * 10) / 10}%`;
}
