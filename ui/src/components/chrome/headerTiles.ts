import { type Breakdown, type Kpis, type PowerTrack, type QuickOverview, type Scope, type SetDeaths, type Side, isSetReport } from '../../api/types';
import {
  formatAmount,
  formatCpm,
  formatDuration,
  formatEventTime,
  formatEventTimeTenths,
  formatFixed,
  formatInteger,
  formatOneDecimal,
  formatPercent,
  formatScaled,
  formatSeconds,
  formatShare,
} from '../../i18n/format';
import { type MessageKey, t } from '../../i18n/i18n';
import { SIDES } from '../../scopeSides';
import { type FightTab, type MetricTab, type ReportData, type TimeRange, analysedEndMs } from '../../store';
import { rowLabel, valueLabel } from '../filters/labels';
import { deathWindowMs, medianMs } from '../deaths/set/lifetimeModel';
import { kickTotals } from '../interrupts/kickTotals';
import type { KpiTone } from '../Kpi';
import { shortName } from '../overview/players';
import { type PullFirst, type SetRow, averageFirstDeath, bestPull, earliestOfPulls, pullFirstDeaths } from '../overview/setOverviewModel';
import { formatCapTime, powerName } from '../resources/powerNames';
import { hitName, reportSpellName } from '../reports/reportData';

export interface HeaderTile {
  label: string;
  value: string;
  sub: string;
  tone?: KpiTone;
  subTone?: 'warn';
}

export interface HeaderInput {
  /** The replay's header has no key figures. */
  tab: Exclude<FightTab, 'replay'>;
  playerCount: number;
  /** The pulls of a pull set, empty while its overview loads; `null` for a single pull. */
  setRows: SetRow[] | null;
  /** The whole pull; `null` while it loads. */
  overview: QuickOverview | null;
  range: TimeRange | null;
  /** The current tab's report; `null` (or another tab's) while it loads. */
  report: ReportData | null;
  reportLoading: boolean;
  /** The last load failed: `report` still holds the figures of the previous range or mode. */
  reportFailed: boolean;
  /** Overview figures of the range, for the tabs that show them (Resources). */
  rangeKpis: Kpis | null;
  /** The metric tabs' breakdown; it shares the report's loading state. */
  breakdown: Breakdown | null;
  scope: Scope;
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
    case 'overview':
      if (input.setRows) return setTiles(input.overview?.kpis ?? null, input.setRows);
      return overviewTiles(input.range === null ? (input.overview?.kpis ?? null) : (ready('overview')?.kpis ?? null), input.range !== null);
    case 'resources': {
      const data = ready('resources');
      const one = input.scope.source.length === 1 && data?.units.length === 1 ? data.units[0].tracks[0] : undefined;
      if (one) return trackTiles(one);
      return overviewTiles(input.range === null ? (input.overview?.kpis ?? null) : input.reportLoading ? null : input.rangeKpis, input.range !== null);
    }
    case 'damage':
      return filtered(input.scope) ? breakdownTiles('damage', input) : damageTiles(ready('damage'));
    case 'healing':
      return filtered(input.scope) ? breakdownTiles('healing', input) : healingTiles(ready('healing'));
    case 'taken':
      return filtered(input.scope) ? breakdownTiles('taken', input) : takenTiles(ready('taken'), input);
    case 'deaths':
      return deathsTiles(ready('deaths'), input);
    case 'buffs':
      return aurasTiles(ready('buffs'), input);
    case 'casts':
      return castsTiles(ready('casts'), input.scope.perspective);
    case 'interrupts':
      return interruptsTiles(ready('interrupts'), input.scope);
  }
}

/** One selected unit: its primary resource's figures. */
function trackTiles(track: PowerTrack): HeaderTile[] {
  const pct = (value: number | null) => (value !== null ? formatShare(value) : '—');
  const power = powerName(track.powerType);
  return [
    { label: t('resources.average'), value: pct(track.avgPct), sub: power },
    { label: t('resources.minimum'), value: pct(track.minPct), sub: power },
    { label: t('resources.atCap'), value: formatCapTime(track.cappedMs), sub: power },
    { label: t('resources.wastedCol'), value: track.wasted > 0 ? formatScaled(track.wasted) : '—', tone: track.wasted > 0 ? 'warn' : undefined, sub: power },
  ];
}

function overviewTiles(kpis: Kpis | null, inRange: boolean): HeaderTile[] {
  const labels = [t('kpi.raidDps'), t('kpi.deaths'), t('kpi.combatPotions'), t('kpi.healthItems')];
  if (!kpis) return labels.map(pendingTile);
  return [
    { label: labels[0], value: formatAmount(kpis.raidDps), sub: t('kpi.raidDamage', { damage: formatAmount(kpis.raidDamage) }) },
    {
      label: labels[1],
      value: formatInteger(kpis.deaths),
      tone: kpis.deaths > 0 ? 'death' : undefined,
      sub: kpis.firstDeathMs !== null ? t('kpi.firstDeath', { time: formatEventTime(kpis.firstDeathMs) }) : t('kpi.noDeaths'),
    },
    {
      label: labels[2],
      value: formatInteger(kpis.combatPotions),
      subTone: kpis.playersWithoutCombatPotion > 0 ? 'warn' : undefined,
      sub: t(inRange ? 'kpi.noCombatPotionInRange' : 'kpi.noCombatPotion', { count: kpis.playersWithoutCombatPotion }),
    },
    {
      label: labels[3],
      value: `${formatInteger(kpis.healthstones)} · ${formatInteger(kpis.healthPotions)}`,
      sub: t('kpi.overDuration', { duration: formatDuration(kpis.durationMs) }),
    },
  ];
}

function setTiles(kpis: Kpis | null, rows: SetRow[]): HeaderTile[] {
  const best = bestPull(rows);
  const labels = [t('kpi.raidDps'), t(best?.kind === 'kill' ? 'kpi.bestKill' : 'kpi.bestWipe'), t('kpi.deaths'), t('kpi.firstDeathLabel')];
  if (!kpis) return labels.map(pendingTile);
  const bestValue = best ? (best.kind === 'kill' ? formatDuration(best.row.view.durationMs) : formatPercent(best.row.view.bossHpPercent ?? 0)) : '—';
  return [
    { label: labels[0], value: formatAmount(kpis.raidDps), sub: t('kpi.damageOver', { damage: formatAmount(kpis.raidDamage), duration: formatDuration(kpis.durationMs) }) },
    { label: labels[1], value: bestValue, sub: best ? t('kpi.pullNumber', { n: best.row.view.n }) : '' },
    setDeathsTile(kpis.deaths, rows.length),
    firstDeathTile(pullFirstDeaths(rows)),
  ];
}

function setDeathsTile(deaths: number, pulls: number): HeaderTile {
  return {
    label: t('kpi.deaths'),
    value: formatInteger(deaths),
    tone: deaths > 0 ? 'death' : undefined,
    sub: t('kpi.deathsPerPull', { count: formatOneDecimal(pulls > 0 ? deaths / pulls : 0) }),
  };
}

function firstDeathTile(pulls: PullFirst[]): HeaderTile {
  const earliest = earliestOfPulls(pulls);
  return {
    label: t('kpi.firstDeathLabel'),
    value: averageFirstDeath(pulls),
    sub: earliest ? t('kpi.earliestFirstDeath', { time: formatEventTimeTenths(earliest.ms), n: earliest.n }) : t('kpi.noDeaths'),
  };
}

/** The earliest of each report pull's `times`, numbered as in the set's rows. */
function pullFirsts<P extends { fightIndex: number }>(pulls: P[], rows: SetRow[], times: (pull: P) => number[]): PullFirst[] {
  const numbers = new Map(rows.map((row) => [row.pull.fightIndex, row.view.n]));
  return pulls.flatMap((pull) => {
    const n = numbers.get(pull.fightIndex);
    const all = times(pull);
    return n === undefined ? [] : [{ ms: all.length > 0 ? Math.min(...all) : null, n }];
  });
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
    { label: labels[0], value: formatScaled(perSecond(report.total, report.durationMs)), sub: t('kpi.raidDamage', { damage: formatScaled(report.total) }) },
    { label: labels[1], value: top ? formatScaled(top.perSecond) : '—', sub: top ? playerName(report.roster, top.player) : '' },
    { label: labels[2], value: formatScaled(support), tone: support > 0 ? 'support' : undefined, sub: t('kpi.ofRaidDamage', { share: share(support, report.total) }) },
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
    { label: labels[0], value: formatScaled(perSecond(report.total, report.durationMs)), sub: t('kpi.raidHealing', { healing: formatScaled(report.total) }) },
    { label: labels[1], value: share(report.overheal, healed + report.overheal), sub: t('kpi.overhealed', { amount: formatScaled(report.overheal) }) },
    { label: labels[2], value: formatScaled(absorbs), sub: t('kpi.ofHealing', { share: share(absorbs, report.total) }) },
    { label: labels[3], value: top ? formatScaled(top.perSecond) : '—', sub: top ? playerName(report.roster, top.player) : '' },
  ];
}

const filtered = (scope: Scope) =>
  scope.perspective !== 'friendly' || scope.source.length + scope.target.length + scope.ability.length > 0;

const TOTAL_LABEL: Record<MetricTab, MessageKey> = { damage: 'tabs.damageDone', healing: 'tabs.healing', taken: 'tabs.damageTaken' };
const RATE_LABEL: Record<MetricTab, MessageKey> = { damage: 'report.dps', healing: 'report.hps', taken: 'report.dtps' };

/** A filtered metric tab: the scope's total and rate, its top row and row count under the effective grouping. */
function breakdownTiles(tab: MetricTab, input: HeaderInput): HeaderTile[] {
  const breakdown = input.reportLoading || input.reportFailed ? null : input.breakdown;
  const group = breakdown?.group ?? SIDES[tab].own;
  const labels = [t(TOTAL_LABEL[tab]), t(RATE_LABEL[tab]), t(`kpi.top.${group}`), t(`breakdown.split.${group}`)];
  if (!breakdown) return labels.map(pendingTile);
  const top = breakdown.rows[0];
  return [
    { label: labels[0], value: formatScaled(breakdown.total), sub: '' },
    { label: labels[1], value: formatScaled(breakdown.perSecond), sub: '' },
    { label: labels[2], value: top ? rowLabel(top) : '—', sub: top ? formatScaled(top.amount) : '' },
    { label: labels[3], value: formatInteger(breakdown.rows.length), sub: '' },
  ];
}

/** The Overview's rule: a range from 0:00 also holds what happened before the pull (prepull lust); nothing after the analysed end counts. */
function inRange(range: TimeRange | null, at: number, overview: QuickOverview): boolean {
  const { durationMs } = overview.timeline;
  const startMs = range?.startMs ?? 0;
  const endMs = Math.min(range?.endMs ?? durationMs, analysedEndMs(overview));
  if (startMs === 0 && endMs >= durationMs) return true;
  return (at < endMs || (at === endMs && endMs >= durationMs)) && (at >= startMs || startMs === 0);
}

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
    { label: labels[0], value: formatScaled(report.total), sub: t('kpi.dtps', { amount: formatScaled(perSecond(report.total, report.durationMs)) }) },
    { label: labels[1], value: ability ? formatScaled(ability.amount) : '—', sub: ability ? hitName(ability, (id) => reportSpellName(report.spells, id)) : '' },
    { label: labels[2], value: player ? formatScaled(player.amount) : '—', sub: player ? playerName(report.roster, player.player) : '' },
    !input.overview
      ? pendingTile(labels[3])
      : input.setRows
        ? setDeathsTile(input.overview.kpis.deaths, input.setRows.length)
        : deathsTile(input.overview.timeline.markers.deaths.map((d) => d.t).filter((at) => inRange(input.range, at, input.overview!))),
  ];
}

/** The deaths tiles from the core; one selected player trades Survivors for the time dead, enemies count kills. */
function deathsTiles(report: ReportOf['deaths'] | null, input: HeaderInput): HeaderTile[] {
  const enemies = input.scope.perspective === 'enemy';
  const setReport = report && isSetReport(report) ? report : null;
  if (input.setRows && !enemies) return setFriendlyDeathsTiles(setReport, input.setRows);
  const onePlayer = !enemies && input.scope.target.length === 1 && input.scope.target[0].kind === 'player';
  const labels = enemies
    ? [t('kpi.kills'), t('kpi.mostLethal'), t('kpi.topKiller'), t('kpi.avgAlive')]
    : [t('kpi.deaths'), t('kpi.mostLethal'), t('kpi.battleRes'), t(onePlayer ? 'kpi.timeDead' : 'kpi.survivors')];
  if (!report) return labels.map(pendingTile);
  const lethal = report.mostLethal;
  const lethalTile: HeaderTile = {
    label: labels[1],
    value: lethal ? t('kpi.times', { count: lethal.count }) : '—',
    sub: lethal ? hitName(lethal, (id) => reportSpellName(report.spells, id)) : '',
  };
  if (enemies) {
    const killer = report.topKiller;
    return [
      setReport ? setKillsTile(setReport, input.setRows ?? []) : killsTile(report.kills.map((k) => k.t)),
      lethalTile,
      { label: labels[2], value: killer ? valueLabel(killer.unit.unit, killer.unit.name, killer.unit.number) : '—', sub: killer ? t('kpi.killingBlows', { count: killer.count }) : '' },
      { label: labels[3], value: report.avgAliveMs !== null ? formatDuration(report.avgAliveMs) : '—', sub: '' },
    ];
  }
  const count = report.deaths.length;
  return [
    deathsTile(report.deaths.map((d) => d.t)),
    lethalTile,
    { label: labels[2], value: formatInteger(report.rezzed), sub: t('kpi.ofDeaths', { count }) },
    onePlayer
      ? { label: labels[3], value: formatDuration(report.deadMs), sub: t('kpi.ofDeaths', { count }) }
      : { label: labels[3], value: formatInteger(Math.max(0, input.playerCount - report.deadUnits)), sub: t('kpi.ofPlayers', { count: input.playerCount }) },
  ];
}

function killsTile(times: number[]): HeaderTile {
  return {
    label: t('kpi.kills'),
    value: formatInteger(times.length),
    sub: times.length > 0 ? t('kpi.firstKill', { time: formatEventTime(Math.min(...times)) }) : t('kpi.noKills'),
  };
}

function setKillsTile(report: SetDeaths, rows: SetRow[]): HeaderTile {
  const first = earliestOfPulls(pullFirsts(report.pulls, rows, (pull) => pull.kills.map((k) => k.t)));
  return {
    label: t('kpi.kills'),
    value: formatInteger(report.pulls.reduce((sum, pull) => sum + pull.kills.length, 0)),
    sub: first ? t('kpi.firstKillInPull', { time: formatEventTime(first.ms), n: first.n }) : t('kpi.noKills'),
  };
}

/** A set's friendly deaths: the count per pull, the deadliest spell with its main source, the median death window and the first death. */
function setFriendlyDeathsTiles(report: SetDeaths | null, rows: SetRow[]): HeaderTile[] {
  const labels = [t('kpi.deaths'), t('kpi.mostLethal'), t('kpi.medianWindow'), t('kpi.firstDeathLabel')];
  if (!report) return labels.map(pendingTile);
  const deaths = report.pulls.flatMap((pull) => pull.deaths);
  const lethal = report.mostLethal;
  const source = lethal ? report.byKillingBlow.find((row) => row.spellId === lethal.spellId && row.environmental === lethal.environmental)?.sources[0] : undefined;
  const median = medianMs(deaths.map(deathWindowMs));
  return [
    setDeathsTile(deaths.length, report.pulls.length),
    {
      label: labels[1],
      value: lethal ? hitName(lethal, (id) => reportSpellName(report.spells, id)) : '—',
      sub: lethal ? (source ? t('kpi.lethalDeaths', { count: lethal.count, source }) : t('deaths.count', { count: lethal.count })) : '',
    },
    { label: labels[2], value: median !== null ? formatSeconds(median) : '—', sub: median !== null ? t('kpi.medianWindowSub') : '' },
    firstDeathTile(pullFirsts(report.pulls, rows, (pull) => pull.lifetime.flatMap((life) => life.firstDeathMs ?? []))),
  ];
}

function alliesLine(allies: number): string {
  const shown = Math.round(allies * 100) / 100;
  return t('kpi.alliesOnAverage', { count: shown, value: formatFixed(allies, 2) });
}

/** A set's overview has no Bloodlust markers: its buffs tiles leave Bloodlust out. */
function aurasTiles(report: ReportOf['buffs'] | null, input: HeaderInput): HeaderTile[] {
  const byTarget = report?.group === 'target';
  const inSet = input.setRows !== null;
  const labels = [t('kpi.bloodlust'), t('kpi.ebonMight'), t(byTarget ? 'kpi.targets' : 'kpi.auras'), t('kpi.players')];
  if (!report) return (inSet ? labels.slice(1) : labels).map(pendingTile);
  const overview = input.overview;
  const lust = overview?.timeline.markers.bloodlust.find((l) => inRange(input.range, l.t, overview));
  const ebon = report.ebonMight;
  const onEnemies = input.scope.perspective === 'enemy';
  const lustTile: HeaderTile = !overview
    ? pendingTile(labels[0])
    : {
        label: labels[0],
        value: lust ? formatEventTime(lust.t) : '—',
        sub: lust ? reportSpellName(overview.spells, lust.spellId) : t('kpi.noBloodlust'),
      };
  return [
    ...(inSet ? [] : [lustTile]),
    {
      label: labels[1],
      value: ebon ? formatShare(ebon.uptime * 100) : '—',
      tone: ebon ? 'support' : undefined,
      sub: ebon ? alliesLine(ebon.allies) : t('kpi.noEbonMight'),
    },
    { label: labels[2], value: formatInteger(report.rows.length), sub: t('kpi.inThisView') },
    { label: labels[3], value: formatInteger(report.players), sub: t(onEnemies ? 'kpi.whoApplied' : 'kpi.withAuras') },
  ];
}

/** Casts by the effective grouping: total, mean CPM per row, the top row and the row count. */
function castsTiles(report: ReportOf['casts'] | null, perspective: Side): HeaderTile[] {
  const group = report?.breakdown.group ?? 'source';
  const labels = [t('kpi.casts'), t('kpi.avgCpm'), t(`kpi.top.${group}`), t(`breakdown.split.${group}`)];
  if (!report) return labels.map(pendingTile);
  const { breakdown } = report;
  const top = breakdown.rows[0];
  const minutes = breakdown.durationMs / 60_000;
  const cpm = breakdown.rows.length > 0 && minutes > 0 ? breakdown.total / breakdown.rows.length / minutes : 0;
  return [
    { label: labels[0], value: formatInteger(breakdown.total), sub: t('kpi.overDuration', { duration: formatDuration(breakdown.durationMs) }) },
    { label: labels[1], value: formatCpm(cpm), sub: t(group === 'ability' ? 'kpi.perAbility' : perspective === 'friendly' ? 'kpi.perPlayer' : 'kpi.perEnemy') },
    { label: labels[2], value: top ? rowLabel(top) : '—', sub: top ? t('kpi.times', { count: top.amount }) : '' },
    { label: labels[3], value: formatInteger(breakdown.rows.length), sub: '' },
  ];
}

function interruptsTiles(report: ReportOf['interrupts'] | null, scope: Scope): HeaderTile[] {
  const labels = [t('kicks.interrupts'), t('kicks.dispels'), t('kicks.missed'), t('kicks.most')];
  if (!report) return labels.map(pendingTile);
  const by = (count: number) => (count === 0 ? '—' : t('kicks.bySources', { count }));
  const top = report.mostInterrupted;
  const { interrupts, dispels, missed } = kickTotals(report);
  const friendlyOnly = scope.perspective === 'friendly' && scope.source.length === 0;
  return [
    { label: labels[0], value: formatInteger(interrupts), sub: by(report.kickers) },
    { label: labels[1], value: formatInteger(dispels), sub: by(report.dispellers) },
    friendlyOnly
      ? { label: labels[2], value: formatInteger(missed), tone: missed > 0 ? 'warn' : undefined, sub: t('kicks.missedSub') }
      : { label: labels[2], value: '—', sub: scope.perspective === 'friendly' ? t('kicks.missedNoSource') : t('kicks.missedFriendlies') },
    { label: labels[3], value: top ? t('kicks.times', { count: top.count }) : '—', sub: top ? reportSpellName(report.spells, top.spellId) : '—' },
  ];
}
