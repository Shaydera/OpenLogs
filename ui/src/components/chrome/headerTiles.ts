import type { Breakdown, FightRow, Kpis, PowerTrack, QuickOverview, Scope, Side } from '../../api/types';
import { formatAmount, formatCpm, formatDuration, formatEventTime, formatInteger, formatScaled, formatShare } from '../../i18n/format';
import { type MessageKey, t } from '../../i18n/i18n';
import { SIDES } from '../../scopeSides';
import type { FightTab, MetricTab, ReportData, TimeRange } from '../../store';
import { rowLabel, valueLabel } from '../filters/labels';
import type { KpiTone } from '../Kpi';
import { shortName } from '../overview/players';
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
  tab: FightTab;
  row: FightRow;
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

/** The Overview's rule: a range from 0:00 also holds what happened before the pull (prepull lust). */
const inRange = (range: TimeRange | null, at: number, durationMs: number) =>
  range === null || ((at < range.endMs || (at === range.endMs && range.endMs >= durationMs)) && (at >= range.startMs || range.startMs === 0));

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
    input.overview ? deathsTile(input.overview.timeline.markers.deaths.map((d) => d.t).filter((at) => inRange(input.range, at, input.overview!.timeline.durationMs))) : pendingTile(labels[3]),
  ];
}

/** The deaths tiles from the core; one selected player trades Survivors for the time dead, enemies count kills. */
function deathsTiles(report: ReportOf['deaths'] | null, input: HeaderInput): HeaderTile[] {
  const enemies = input.scope.perspective === 'enemy';
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
    const times = report.kills.map((k) => k.t);
    const killer = report.topKiller;
    return [
      {
        label: labels[0],
        value: formatInteger(times.length),
        sub: times.length > 0 ? t('kpi.firstKill', { time: formatEventTime(Math.min(...times)) }) : t('kpi.noKills'),
      },
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
      : { label: labels[3], value: formatInteger(Math.max(0, input.row.playerCount - report.deadUnits)), sub: t('kpi.ofPlayers', { count: input.row.playerCount }) },
  ];
}

function aurasTiles(report: ReportOf['buffs'] | null, input: HeaderInput): HeaderTile[] {
  const byTarget = report?.group === 'target';
  const labels = [t('kpi.bloodlust'), t('kpi.ebonMight'), t(byTarget ? 'kpi.targets' : 'kpi.auras'), t('kpi.players')];
  if (!report) return labels.map(pendingTile);
  const overview = input.overview;
  const lust = overview?.timeline.markers.bloodlust.find((l) => inRange(input.range, l.t, overview.timeline.durationMs));
  const ebon = report.ebonMight;
  const onEnemies = input.scope.perspective === 'enemy';
  return [
    !overview
      ? pendingTile(labels[0])
      : {
          label: labels[0],
          value: lust ? formatEventTime(lust.t) : '—',
          sub: lust ? reportSpellName(overview.spells, lust.spellId) : t('kpi.noBloodlust'),
        },
    {
      label: labels[1],
      value: ebon ? formatShare(ebon.uptime * 100) : '—',
      tone: ebon ? 'support' : undefined,
      sub: ebon ? t('kpi.onPlayers', { count: ebon.holders }) : t('kpi.noEbonMight'),
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
  const missed = report.missed.length;
  const friendlyOnly = scope.perspective === 'friendly' && scope.source.length === 0;
  return [
    { label: labels[0], value: formatInteger(report.interrupts.length), sub: by(report.kickers) },
    { label: labels[1], value: formatInteger(report.dispels.length), sub: by(report.dispellers) },
    friendlyOnly
      ? { label: labels[2], value: formatInteger(missed), tone: missed > 0 ? 'warn' : undefined, sub: t('kicks.missedSub') }
      : { label: labels[2], value: '—', sub: scope.perspective === 'friendly' ? t('kicks.missedNoSource') : t('kicks.missedFriendlies') },
    { label: labels[3], value: top ? t('kicks.times', { count: top.count }) : '—', sub: top ? reportSpellName(report.spells, top.spellId) : '—' },
  ];
}
