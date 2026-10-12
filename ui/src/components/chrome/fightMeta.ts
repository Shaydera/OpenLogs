import type { FightRow, RunInfo } from '../../api/types';
import { formatDateTime, formatDuration, formatPercent } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { difficultyName, runProgress } from '../../pulls/groupPulls';

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
  const duration: MetaItem = { text: formatDuration(row.durationMs), mono: true };
  const items = row.run
    ? [duration, ...runFacts(row, row.run)]
    : [
        fact(difficultyName(row)),
        duration,
        fact(t('fight.players', { count: row.playerCount })),
        fact(formatDateTime(row.startUnixMs)),
        fact(row.zone),
        row.bossHpPercent !== null && row.outcome !== 'kill' ? fact(t('fight.bossHp', { percent: formatPercent(row.bossHpPercent) })) : null,
      ];
  return items.filter((item): item is MetaItem => item !== null);
}

/** A Mythic+ run: timer and bosses only from the dungeon data, never from the log alone. */
function runFacts(row: FightRow, run: RunInfo): (MetaItem | null)[] {
  return [
    fact(t('fight.players', { count: row.playerCount })),
    fact(formatDateTime(row.startUnixMs)),
    // An abandoned key logs 0; that is no time worth showing.
    run.totalTimeMs ? fact(t('runs.loggedTime', { time: formatDuration(run.totalTimeMs) })) : null,
    ...runProgress(run).map((part) => fact(part)),
    run.affixIds.length > 0 ? fact(t('runs.affixes', { ids: run.affixIds.join(', ') })) : null,
  ];
}
