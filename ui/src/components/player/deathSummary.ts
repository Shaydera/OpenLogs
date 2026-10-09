import type { ContextItem, PlayerDeath, PlayerDetail } from '../../api/types';
import { formatAmount, formatCount, formatList, formatSeconds } from '../../i18n/format';
import { locale, t } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/i18n';
import { hitName, reportSpellName } from '../reports/reportData';

const CONSUMABLE: Record<Exclude<ContextItem, 'defensive' | 'combat_potion'>, MessageKey> = {
  healthstone: 'player.death.healthstone',
  health_potion: 'player.death.healthPotion',
};

/**
 * The lethal burst, then defensives on cooldown or unused, then unused consumables. Used items and the
 * combat potion are left out; a consumable on cooldown was drunk, so it counts as used.
 */
export function deathSummary(detail: PlayerDetail, death: PlayerDeath): string {
  const name = (spellId: number) => reportSpellName(detail.spells, spellId);
  const parts: string[] = [];
  const kb = death.killingBlow;
  const burst = death.lethalBurst;
  if (kb && burst) {
    const spell = hitName({ spellId: burst.spellId, environmental: kb.environmental }, name);
    parts.push(
      burst.count > 1
        ? t('player.death.burst', { times: formatCount(burst.count), spell, window: formatSeconds(burst.windowMs) })
        : // The damage the hit did: its overkill went past the player's HP.
          t('player.death.single', { spell, amount: formatAmount(Math.max(0, kb.amount - kb.overkill)) }),
    );
  }
  const defensive = { cooldown: [] as string[], unused: [] as string[] };
  const consumableUnused: string[] = [];
  for (const entry of death.context) {
    if (entry.item === 'defensive') {
      if (entry.state === 'on_cooldown') defensive.cooldown.push(name(entry.spellId));
      else if (entry.state !== 'used') defensive.unused.push(name(entry.spellId));
    } else if (entry.item !== 'combat_potion' && entry.state !== 'used' && entry.state !== 'on_cooldown') {
      consumableUnused.push(t(CONSUMABLE[entry.item]));
    }
  }
  const clauses = [
    [defensive.cooldown, 'player.death.onCooldown'],
    [defensive.unused, 'player.death.unused'],
    [consumableUnused, 'player.death.unused'],
  ] as const;
  const text = clauses
    .filter(([items]) => items.length > 0)
    .map(([items, key]) => t(key, { list: formatList(items) }))
    .join('; ');
  if (text) parts.push(`${text.charAt(0).toLocaleUpperCase(locale)}${text.slice(1)}.`);
  return parts.join(' ');
}
