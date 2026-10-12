import type { Detail, FightRow, LogView, PlayerRef, QuickOverview } from '../../api/types';
import { formatDuration, formatKeystoneLevel } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { pullStatus, pullView, runStatus } from '../../pulls/groupPulls';
import type { FightTab, ReportData } from '../../store';
import { playerIndex, shortName, spellName } from '../overview/players';

/** What a breadcrumb link does. */
export type CrumbAction =
  | { kind: 'pulls' }
  | { kind: 'fight'; index: number }
  | { kind: 'overview' }
  | { kind: 'detail'; depth: number }
  | { kind: 'closeComparison' };

export interface Crumb {
  label: string;
  /** `null`: plain text (the "Enemies" level) or the page shown. */
  action: CrumbAction | null;
  /** The page shown: the last level. */
  current: boolean;
}

export interface CrumbInput {
  log: LogView;
  row: FightRow;
  tab: FightTab;
  details: Detail[];
  /** The whole-pull overview: player and spell names while a detail page loads. */
  overview: QuickOverview | null;
  report: ReportData | null;
  comparing: boolean;
}

type Level = Omit<Crumb, 'current'>;

/** A boss pull's number among the boss's pulls, or among the boss pulls of its Mythic+ run (hidden pulls count). */
function pullNumber(fights: FightRow[], row: FightRow): number | null {
  if (row.runIndex === null) return pullView(fights, row.index)?.n ?? null;
  const at = fights.filter((fight) => fight.runIndex === row.runIndex).findIndex((fight) => fight.index === row.index);
  return at === -1 ? null : at + 1;
}

/** `Ula'tek · Pull #1`, or a run's `Priory of the Sacred Flame +12`. */
function pullLabel(fights: FightRow[], row: FightRow): string {
  if (row.run) return t('runs.heading', { dungeon: row.name, level: formatKeystoneLevel(row.run.keystoneLevel) });
  const n = pullNumber(fights, row);
  return n === null ? row.name : t('crumb.pull', { boss: row.name, n });
}

/** `Kill 7:58`, `Wipe 2:22`, a run's `Completed 31:00`. */
function resultLabel(row: FightRow): string {
  const result = row.run ? t(`runs.status.${runStatus(row)}`) : t(`status.${pullStatus(row)}`);
  return t('crumb.result', { result, duration: formatDuration(row.durationMs) });
}

/** One level per detail page; an enemy sits under a plain "Enemies" level. */
function detailLevels(details: Detail[], overview: QuickOverview | null, report: ReportData | null): Level[] {
  const roster = overview ? playerIndex(overview) : new Map<number, PlayerRef>();
  const playerName = (id: number) => {
    const loaded = report?.tab === 'player' && report.data.player.actorId === id ? report.data.player.name : null;
    const name = roster.get(id)?.name ?? loaded;
    return name === null ? t('report.unknownPlayer') : shortName(name);
  };
  return details.flatMap((detail, depth): Level[] => {
    const action: CrumbAction = { kind: 'detail', depth };
    switch (detail.kind) {
      case 'player':
        return [{ label: playerName(detail.player), action }];
      case 'ability': {
        // Melee (spell 0) has an empty spell name: it falls through to "Melee".
        const loaded = report?.tab === 'ability' && report.data.spellId === detail.spellId ? report.data.spellName || null : null;
        const fallback = detail.spellId === 0 ? t('overview.melee') : overview ? spellName(overview, detail.spellId) : t('overview.unknownSpell', { id: detail.spellId });
        const label = loaded ?? (detail.spellName || fallback);
        return [{ label, action }];
      }
      case 'target': {
        // The empty "Enemies" entry until the backend resolved it to an enemy.
        const name = detail.name || (report?.tab === 'target' ? report.data.name : '');
        const enemies: Level = { label: t('target.enemies'), action: null };
        return name ? [enemies, { label: name, action }] : [enemies];
      }
    }
  });
}

/**
 * The fight top bar's breadcrumb: the log file, a Mythic+ boss pull's run, then the pull — alone on
 * the Overview, with result and duration on the report tabs, with the tab on Casts, with the detail
 * stack on detail pages. Every level but the last links somewhere.
 */
export function fightCrumbs({ log, row, tab, details, overview, report, comparing }: CrumbInput): Crumb[] {
  const levels: Level[] = [{ label: log.fileName, action: { kind: 'pulls' } }];
  const run = row.runIndex === null ? undefined : log.fights.find((fight) => fight.index === row.runIndex);
  if (run) levels.push({ label: pullLabel(log.fights, run), action: { kind: 'fight', index: run.index } });
  const pull = pullLabel(log.fights, row);
  if (comparing) {
    levels.push({ label: pull, action: { kind: 'closeComparison' } }, { label: t('crumb.comparison'), action: null });
  } else if (details.length > 0) {
    levels.push({ label: pull, action: { kind: 'overview' } }, ...detailLevels(details, overview, report));
  } else if (tab === 'overview') {
    levels.push({ label: pull, action: null });
  } else if (tab === 'casts') {
    levels.push({ label: pull, action: { kind: 'overview' } }, { label: t('tabs.casts'), action: null });
  } else {
    levels.push({ label: t('crumb.withResult', { pull, result: resultLabel(row) }), action: null });
  }
  return levels.map((level, i) => (i === levels.length - 1 ? { ...level, action: null, current: true } : { ...level, current: false }));
}
