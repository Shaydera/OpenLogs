import type { AuraScope, FightRow, Kpis, QuickOverview } from '../../api/types';
import { formatAmount, formatCpm, formatDuration, formatEventTime, formatInteger, formatShare } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import type { FightTab, ReportData, TimeRange } from '../../store';
import type { KpiTone } from '../Kpi';
import { mostInterrupted } from '../interrupts/kickModel';
import { shortName } from '../overview/players';
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
  hideProcs: boolean;
  auraScope: AuraScope;
}

const EBON_MIGHT = 395152;

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
    case 'resources':
      return overviewTiles(input.range === null ? (input.overview?.kpis ?? null) : input.reportLoading ? null : input.rangeKpis, input.range !== null);
    case 'damage':
      return damageTiles(ready('damage'));
    case 'healing':
      return healingTiles(ready('healing'));
    case 'taken':
      return takenTiles(ready('taken'), input);
    case 'deaths':
      return deathsTiles(ready('deaths'), input.row);
    case 'buffs':
      return aurasTiles(ready('buffs'), input);
    case 'casts':
      return castsTiles(ready('casts'), input.hideProcs);
    case 'interrupts':
      return interruptsTiles(ready('interrupts'));
  }
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

/** The Overview's rule: a range from 0:00 also holds what happened before the pull (prepull lust). */
const inRange = (range: TimeRange | null, at: number) => range === null || (at < range.endMs && (at >= range.startMs || range.startMs === 0));

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
    input.overview ? deathsTile(input.overview.timeline.markers.deaths.map((d) => d.t).filter((at) => inRange(input.range, at))) : pendingTile(labels[3]),
  ];
}

function deathsTiles(report: ReportOf['deaths'] | null, row: FightRow): HeaderTile[] {
  const labels = [t('kpi.deaths'), t('kpi.mostLethal'), t('kpi.battleRes'), t('kpi.survivors')];
  if (!report) return labels.map(pendingTile);
  const byAbility = new Map<string, number>();
  for (const death of report.deaths) {
    if (!death.killingBlow) continue;
    const name = hitName(death.killingBlow, (id) => reportSpellName(report.spells, id));
    byAbility.set(name, (byAbility.get(name) ?? 0) + 1);
  }
  // Map order is first-seen, so a tie goes to the ability that killed first.
  const lethal = [...byAbility].reduce<[string, number] | null>((best, entry) => (!best || entry[1] > best[1] ? entry : best), null);
  const rezzed = report.deaths.filter((d) => d.resurrectedAt !== null).length;
  const dead = new Set(report.deaths.map((d) => d.player)).size;
  const survivors = Math.max(0, row.playerCount - dead);
  return [
    deathsTile(report.deaths.map((d) => d.t)),
    { label: labels[1], value: lethal ? t('kpi.times', { count: lethal[1] }) : '—', sub: lethal ? lethal[0] : '' },
    { label: labels[2], value: formatInteger(rezzed), sub: t('kpi.ofDeaths', { count: report.deaths.length }) },
    { label: labels[3], value: formatInteger(survivors), sub: t('kpi.ofPlayers', { count: row.playerCount }) },
  ];
}

function aurasTiles(report: ReportOf['buffs'] | null, input: HeaderInput): HeaderTile[] {
  const labels = [t('kpi.bloodlust'), t('kpi.ebonMight'), t('kpi.auras'), t('kpi.players')];
  if (!report) return labels.map(pendingTile);
  const overview = input.overview;
  const lust = overview?.timeline.markers.bloodlust.find((l) => inRange(input.range, l.t));
  const ebon = report.rows.find((r) => r.spellIds.includes(EBON_MIGHT));
  // Enemy debuffs have no player targets; there the players who applied them count.
  const onEnemies = input.auraScope === 'debuffs_on_enemies';
  const players = new Set(
    report.rows.flatMap((r) => (onEnemies ? r.sources : r.targets.flatMap((target) => (target.player === null ? [] : [target.player])))),
  ).size;
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
      sub: ebon ? t('kpi.onPlayers', { count: ebon.targets.length }) : t('kpi.noEbonMight'),
    },
    { label: labels[2], value: formatInteger(report.rows.length), sub: t('kpi.inThisView') },
    { label: labels[3], value: formatInteger(players), sub: t(onEnemies ? 'kpi.whoApplied' : 'kpi.withAuras') },
  ];
}

function castsTiles(report: ReportOf['casts'] | null, hideProcs: boolean): HeaderTile[] {
  const labels = [t('kpi.casts'), t('kpi.avgCpm'), t('kpi.mostCast'), t('kpi.players')];
  if (!report) return labels.map(pendingTile);
  const bySpell = new Map<number, number>();
  let total = 0;
  let casting = 0;
  for (const player of report.players) {
    const spells = player.spells.filter((s) => !hideProcs || !s.procTrigger);
    const casts = spells.reduce((sum, s) => sum + s.casts, 0);
    total += casts;
    if (casts > 0) casting += 1;
    for (const s of spells) bySpell.set(s.spellId, (bySpell.get(s.spellId) ?? 0) + s.casts);
  }
  const most = [...bySpell].reduce<[number, number] | null>((best, entry) => (!best || entry[1] > best[1] ? entry : best), null);
  const minutes = report.durationMs / 60_000;
  const cpm = casting > 0 && minutes > 0 ? total / casting / minutes : 0;
  return [
    { label: labels[0], value: formatInteger(total), sub: t('kpi.overDuration', { duration: formatDuration(report.durationMs) }) },
    { label: labels[1], value: formatCpm(cpm), sub: t('kpi.perPlayer') },
    { label: labels[2], value: most ? t('kpi.times', { count: most[1] }) : '—', sub: most ? reportSpellName(report.spells, most[0]) : '' },
    { label: labels[3], value: formatInteger(casting), sub: t('kpi.withCasts') },
  ];
}

function interruptsTiles(report: ReportOf['interrupts'] | null): HeaderTile[] {
  const labels = [t('kicks.interrupts'), t('kicks.dispels'), t('kicks.missed'), t('kicks.most')];
  if (!report) return labels.map(pendingTile);
  const kickers = new Set(report.interrupts.map((k) => k.player)).size;
  const dispellers = new Set(report.dispels.map((d) => d.player)).size;
  const top = mostInterrupted(report);
  return [
    { label: labels[0], value: formatInteger(report.interrupts.length), sub: kickers > 0 ? t('kicks.byPlayers', { count: kickers }) : '—' },
    { label: labels[1], value: formatInteger(report.dispels.length), sub: dispellers > 0 ? t('kicks.byPlayers', { count: dispellers }) : '—' },
    { label: labels[2], value: formatInteger(report.missed.length), tone: report.missed.length > 0 ? 'warn' : undefined, sub: t('kicks.missedSub') },
    { label: labels[3], value: top ? t('kicks.times', { count: top.count }) : '—', sub: top ? reportSpellName(report.spells, top.spellId) : '—' },
  ];
}
