import type { FightRow, SetPull } from '../../api/types';
import { formatEventTime } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { type PullView, pullView } from '../../pulls/groupPulls';

export interface SetRow {
  pull: SetPull;
  view: PullView;
}

export type SetOrder = 'inOrder' | 'bestFirst';

export interface BestPull {
  kind: 'kill' | 'wipe';
  row: SetRow;
}

export function setRows(fights: FightRow[], pulls: SetPull[]): SetRow[] {
  return pulls.flatMap((pull) => {
    const view = pullView(fights, pull.fightIndex);
    return view ? [{ pull, view }] : [];
  });
}

const missingLast = (percent: number | null) => percent ?? Number.POSITIVE_INFINITY;

/** Best first: kills by duration, then wipes by the boss HP they reached. */
export function sortRows(rows: SetRow[], order: SetOrder): SetRow[] {
  if (order === 'inOrder') return rows;
  const kills = rows.filter((row) => row.view.status === 'kill').sort((a, b) => a.view.durationMs - b.view.durationMs);
  const others = rows.filter((row) => row.view.status !== 'kill').sort((a, b) => missingLast(a.view.bossHpPercent) - missingLast(b.view.bossHpPercent));
  return [...kills, ...others];
}

/** The wipe that took the boss lowest, else the fastest kill when no wipe has a known boss HP. */
export function bestPull(rows: SetRow[]): BestPull | null {
  const ordered = sortRows(rows, 'bestFirst');
  const wipe = ordered.find((row) => row.view.status !== 'kill' && row.view.bossHpPercent !== null);
  if (wipe) return { kind: 'wipe', row: wipe };
  const kill = ordered.find((row) => row.view.status === 'kill');
  return kill ? { kind: 'kill', row: kill } : null;
}

function firstDeaths(rows: SetRow[]): number[] {
  return rows.map((row) => row.pull.kpis.firstDeathMs).filter((ms): ms is number => ms !== null);
}

/** Mean first-death time over the pulls with a death; `null` when nobody died. */
function averageFirstDeathMs(rows: SetRow[]): number | null {
  const times = firstDeaths(rows);
  return times.length > 0 ? times.reduce((sum, ms) => sum + ms, 0) / times.length : null;
}

/** The mean first death in whole seconds (a pull's own first death shows tenths); `—` when nobody died. */
export function averageFirstDeath(rows: SetRow[]): string {
  const average = averageFirstDeathMs(rows);
  return average !== null ? t('kpi.averageFirstDeath', { time: formatEventTime(average) }) : '—';
}

export function earliestFirstDeath(rows: SetRow[]): { ms: number; n: number } | null {
  return rows.reduce<{ ms: number; n: number } | null>((earliest, row) => {
    const ms = row.pull.kpis.firstDeathMs;
    return ms !== null && (earliest === null || ms < earliest.ms) ? { ms, n: row.view.n } : earliest;
  }, null);
}
