import type { FightRow, LogView, PullSet, RunInfo } from '../../api/types';
import { formatClock, formatDateTime, formatDuration, formatPercent } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { difficultyName, runProgress } from '../../pulls/groupPulls';

export interface MetaItem {
  text: string;
  mono: boolean;
  /** Plain text after a mono `text`, in the same item. */
  suffix?: string;
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

export interface SetIdentity {
  name: string;
  difficulty: string;
  wipes: number;
  kills: number;
  durationMs: number;
  startUnixMs: number;
  endUnixMs: number;
}

/** A set's boss and results; every pull that did not end in a kill counts as a wipe. */
export function setIdentity(log: LogView, set: PullSet): SetIdentity {
  const rows = log.fights.filter((fight) => set.fights.includes(fight.index));
  const kills = rows.filter((row) => row.outcome === 'kill').length;
  return {
    name: rows[0].name,
    difficulty: difficultyName(rows[0]),
    wipes: rows.length - kills,
    kills,
    durationMs: rows.reduce((sum, row) => sum + row.durationMs, 0),
    startUnixMs: Math.min(...rows.map((row) => row.startUnixMs)),
    endUnixMs: Math.max(...rows.map((row) => row.startUnixMs + row.durationMs)),
  };
}

/** `Heroic · 9 wipes, 1 kill · 25:44 summed · 96 players · 12:43 – 14:33`; no players while the set loads. */
export function setMeta(set: SetIdentity, players: number | null): MetaItem[] {
  const results = t('fight.setResults', { wipes: t('fight.setWipes', { count: set.wipes }), kills: t('fight.setKills', { count: set.kills }) });
  const items = [
    fact(set.difficulty),
    fact(results),
    { text: formatDuration(set.durationMs), mono: true, suffix: t('fight.summed') },
    players === null ? null : fact(t('fight.players', { count: players })),
    fact(t('fight.timeSpan', { from: formatClock(set.startUnixMs), to: formatClock(set.endUnixMs) })),
  ];
  return items.filter((item): item is MetaItem => item !== null);
}
