import type { FightTimeline } from '../../api/types';
import { formatAmount, formatEventTime, formatInteger, formatShare } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import type { FightTab, ReportData, TimeRange } from '../../store';
import type { KpiTone } from '../Kpi';
import { shortName } from '../overview/players';
import { hitName, reportSpellName } from '../reports/reportData';

export interface HeaderTile {
  label: string;
  value: string;
  sub: string;
  tone?: KpiTone;
}

export interface HeaderInput {
  tab: FightTab;
  /** The whole pull; `null` while it loads. */
  timeline: FightTimeline | null;
  range: TimeRange | null;
  /** The current tab's report; `null` (or another tab's) while it loads. */
  report: ReportData | null;
  reportLoading: boolean;
  /** The last load failed: `report` still holds the figures of the previous range or mode. */
  reportFailed: boolean;
}

type ReportOf = { [R in ReportData as R['tab']]: R['data'] };

const pendingTile = (label: string): HeaderTile => ({ label, value: t('kpi.pending'), sub: '' });

/** The tab's report once it is loaded, else `null` (also while a new range loads). */
function readyData<K extends keyof ReportOf>(input: HeaderInput, want: K): ReportOf[K] | null {
  const { report } = input;
  if (input.reportLoading || input.reportFailed || report?.tab !== want) return null;
  return report.data as ReportOf[K];
}

/** The four key figures of the fight header, chosen per tab; values follow the range. */
export function headerTiles(input: HeaderInput): HeaderTile[] {
  const { tab } = input;
  const ready = <K extends keyof ReportOf>(want: K) => readyData(input, want);
  switch (tab) {
    case 'damage':
      return damageTiles(ready('damage'));
    case 'healing':
      return healingTiles(ready('healing'));
    case 'taken':
      return takenTiles(ready('taken'), input);
  }
}

const perSecond = (total: number, durationMs: number) => (durationMs > 0 ? (total * 1000) / durationMs : 0);
const share = (part: number, whole: number) => formatShare(whole > 0 ? (part / whole) * 100 : 0);

function playerName(roster: { actorId: number; name: string }[], id: number): string {
  const player = roster.find((p) => p.actorId === id);
  return player ? shortName(player.name) : t('report.unknownPlayer');
}

function damageTiles(report: ReportOf['damage'] | null): HeaderTile[] {
  const labels = [t('kpi.raidDps'), t('kpi.topDps'), t('kpi.augSupport'), t('kpi.players')];
  if (!report) return labels.map(pendingTile);
  const top = report.players[0];
  const support = report.players.reduce((sum, p) => sum + p.supportGiven, 0);
  return [
    { label: labels[0], value: formatAmount(perSecond(report.total, report.durationMs)), sub: t('kpi.raidDamage', { damage: formatAmount(report.total) }) },
    { label: labels[1], value: top ? formatAmount(top.perSecond) : '—', sub: top ? playerName(report.roster, top.player) : '' },
    { label: labels[2], value: formatAmount(support), tone: support > 0 ? 'support' : undefined, sub: t('kpi.ofRaidDamage', { share: share(support, report.total) }) },
    { label: labels[3], value: formatInteger(report.players.length), sub: t('kpi.withDamage') },
  ];
}

function healingTiles(report: ReportOf['healing'] | null): HeaderTile[] {
  const labels = [t('kpi.raidHps'), t('kpi.overheal'), t('kpi.absorbs'), t('kpi.topHealer')];
  if (!report) return labels.map(pendingTile);
  const healed = report.players.reduce((sum, p) => sum + p.healing, 0);
  const absorbs = report.players.reduce((sum, p) => sum + p.absorbs, 0);
  const top = report.players[0];
  return [
    { label: labels[0], value: formatAmount(perSecond(report.total, report.durationMs)), sub: t('kpi.raidHealing', { healing: formatAmount(report.total) }) },
    { label: labels[1], value: share(report.overheal, healed + report.overheal), sub: t('kpi.overhealed', { amount: formatAmount(report.overheal) }) },
    { label: labels[2], value: formatAmount(absorbs), sub: t('kpi.ofHealing', { share: share(absorbs, report.total) }) },
    { label: labels[3], value: top ? formatAmount(top.perSecond) : '—', sub: top ? playerName(report.roster, top.player) : '' },
  ];
}

const inRange = (range: TimeRange | null, at: number) => range === null || (at >= range.startMs && at < range.endMs);

function deathsTile(times: number[]): HeaderTile {
  return {
    label: t('kpi.deaths'),
    value: formatInteger(times.length),
    tone: times.length > 0 ? 'death' : undefined,
    sub: times.length > 0 ? t('kpi.firstDeath', { time: formatEventTime(Math.min(...times)) }) : t('kpi.noDeaths'),
  };
}

function takenTiles(report: ReportOf['taken'] | null, input: HeaderInput): HeaderTile[] {
  const labels = [t('kpi.damageTaken'), t('kpi.topAbility'), t('kpi.mostHit'), t('kpi.deaths')];
  if (!report) return labels.map(pendingTile);
  const ability = report.byAbility[0];
  const player = report.byPlayer[0];
  return [
    { label: labels[0], value: formatAmount(report.total), sub: t('kpi.dtps', { amount: formatAmount(perSecond(report.total, report.durationMs)) }) },
    { label: labels[1], value: ability ? formatAmount(ability.amount) : '—', sub: ability ? hitName(ability, (id) => reportSpellName(report.spells, id)) : '' },
    { label: labels[2], value: player ? formatAmount(player.amount) : '—', sub: player ? playerName(report.roster, player.player) : '' },
    input.timeline ? deathsTile(input.timeline.deaths.filter((at) => inRange(input.range, at))) : pendingTile(labels[3]),
  ];
}
