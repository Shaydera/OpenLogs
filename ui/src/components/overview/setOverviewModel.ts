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

/** Boss HP at the pull's analysed end: the last known sample that ends by its cut, else the last known sample. */
export function hpAtEnd(pull: SetPull): number | null {
  if (pull.bossHp.length === 0) return null;
  const last = pull.bossHp.length - 1;
  // A sample holds the last HP seen in its step, so the step the cut falls in may already hold HP from after it.
  const at = pull.cutoffMs === null || pull.bossHpStepMs <= 0 ? last : Math.min(last, Math.floor((pull.cutoffMs + 1) / pull.bossHpStepMs) - 1);
  for (let i = at; i >= 0; i--) {
    const hp = pull.bossHp[i];
    if (hp !== null) return hp;
  }
  return null;
}

/** A killed pull cut at a death ended with the boss alive, so it counts as a wipe. */
const isKill = (row: SetRow) => row.view.status === 'kill' && row.pull.cutoffMs === null;

/** Boss HP where the row's pull ends: the logged value for a whole pull, the HP at the cut for a cut one. */
export function rowHpAtEnd(row: SetRow): number | null {
  if (row.pull.cutoffMs !== null) return hpAtEnd(row.pull);
  return isKill(row) ? 0 : row.view.bossHpPercent;
}

/** Best first: kills by duration, then wipes by the boss HP they reached. */
export function sortRows(rows: SetRow[], order: SetOrder): SetRow[] {
  if (order === 'inOrder') return rows;
  const kills = rows.filter(isKill).sort((a, b) => a.view.durationMs - b.view.durationMs);
  const others = rows.filter((row) => !isKill(row)).sort((a, b) => missingLast(rowHpAtEnd(a)) - missingLast(rowHpAtEnd(b)));
  return [...kills, ...others];
}

/** The wipe that took the boss lowest, else the fastest kill when no wipe has a known boss HP. */
export function bestPull(rows: SetRow[]): BestPull | null {
  const ordered = sortRows(rows, 'bestFirst');
  const wipe = ordered.find((row) => !isKill(row) && rowHpAtEnd(row) !== null);
  if (wipe) return { kind: 'wipe', row: wipe };
  const kill = ordered.find(isKill);
  return kill ? { kind: 'kill', row: kill } : null;
}

/** The time of a pull's first death (or kill) and the pull's number; `ms` is `null` when it has none. */
export interface PullFirst {
  ms: number | null;
  n: number;
}

export const pullFirstDeaths = (rows: SetRow[]): PullFirst[] => rows.map((row) => ({ ms: row.pull.kpis.firstDeathMs, n: row.view.n }));

/** Mean first-death time over the pulls with a death; `null` when nobody died. */
function averageFirstDeathMs(pulls: PullFirst[]): number | null {
  const times = pulls.map((pull) => pull.ms).filter((ms): ms is number => ms !== null);
  return times.length > 0 ? times.reduce((sum, ms) => sum + ms, 0) / times.length : null;
}

/** The mean first death in whole seconds (a pull's own first death shows tenths); `—` when nobody died. */
export function averageFirstDeath(pulls: PullFirst[]): string {
  const average = averageFirstDeathMs(pulls);
  return average !== null ? t('kpi.averageFirstDeath', { time: formatEventTime(average) }) : '—';
}

export function earliestOfPulls(pulls: PullFirst[]): { ms: number; n: number } | null {
  return pulls.reduce<{ ms: number; n: number } | null>(
    (earliest, { ms, n }) => (ms !== null && (earliest === null || ms < earliest.ms) ? { ms, n } : earliest),
    null,
  );
}
