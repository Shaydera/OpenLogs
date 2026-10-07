import type { FightRow, LogView } from '../../api/types';
import { formatDuration } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { pullStatus, pullView } from '../../pulls/groupPulls';

/** What a breadcrumb link does. */
export type CrumbAction = { kind: 'pulls' };

export interface Crumb {
  label: string;
  /** `null`: the page shown. */
  action: CrumbAction | null;
  /** The page shown: the last level. */
  current: boolean;
}

export interface CrumbInput {
  log: LogView;
  row: FightRow;
}

type Level = Omit<Crumb, 'current'>;

/** `Ula'tek · Pull #1`: the pull's number among the boss's pulls (hidden pulls count). */
function pullLabel(fights: FightRow[], row: FightRow): string {
  const n = pullView(fights, row.index)?.n ?? null;
  return n === null ? row.name : t('crumb.pull', { boss: row.name, n });
}

/** `Kill 7:58`, `Wipe 2:22`. */
function resultLabel(row: FightRow): string {
  return t('crumb.result', { result: t(`status.${pullStatus(row)}`), duration: formatDuration(row.durationMs) });
}

/**
 * The fight top bar's breadcrumb: the log file, then the pull with result and duration. Every level
 * but the last links somewhere.
 */
export function fightCrumbs({ log, row }: CrumbInput): Crumb[] {
  const levels: Level[] = [{ label: log.fileName, action: { kind: 'pulls' } }];
  const pull = pullLabel(log.fights, row);
  levels.push({ label: t('crumb.withResult', { pull, result: resultLabel(row) }), action: null });
  return levels.map((level, i) => (i === levels.length - 1 ? { ...level, action: null, current: true } : { ...level, current: false }));
}
