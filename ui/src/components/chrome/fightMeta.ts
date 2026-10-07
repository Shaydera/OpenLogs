import type { FightRow } from '../../api/types';
import { formatDateTime, formatDuration, formatPercent } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { difficultyName } from '../../pulls/groupPulls';

interface MetaItem {
  text: string;
  mono: boolean;
}

const fact = (text: string | null): MetaItem | null => (text ? { text, mono: false } : null);

/**
 * The facts after the result chip, one item each (`Heroic · 7:58 · 23 players · Oct 7, 2026 · 19:03 ·
 * The Venomous Abyss`); a wipe adds the boss HP at its end.
 */
export function fightMeta(row: FightRow): MetaItem[] {
  const items = [
    fact(difficultyName(row)),
    { text: formatDuration(row.durationMs), mono: true },
    fact(t('fight.players', { count: row.playerCount })),
    fact(formatDateTime(row.startUnixMs)),
    fact(row.zone),
    row.bossHpPercent !== null && row.outcome !== 'kill' ? fact(t('fight.bossHp', { percent: formatPercent(row.bossHpPercent) })) : null,
  ];
  return items.filter((item): item is MetaItem => item !== null);
}
