import type { BossProgress, CombatInfo, FightRow, KeyTimer, PullSet, PullSetKind, RunInfo } from '../api/types';
import { formatDuration, formatInteger, formatSeconds } from '../i18n/format';
import { t } from '../i18n/i18n';

/** Non-kills shorter than this are "aborted" and can be hidden. */
const ABORT_THRESHOLD_MS = 10_000;

export type PullStatus = 'kill' | 'wipe' | 'ended' | 'aborted' | 'incomplete';

/** A run's result: completed, ended without completion, or no end in the log. */
export type RunStatus = 'completed' | 'notCompleted' | 'incomplete';

/** Chip style of a run result: completed like a kill, not completed like a wipe, no end neutral. */
export const RUN_CHIP: Record<RunStatus, string> = { completed: 'kill', notCompleted: 'wipe', incomplete: 'abort' };

export const PULL_CHIP: Record<PullStatus, string> = { kill: 'kill', wipe: 'wipe', incomplete: 'wipe', ended: 'ended', aborted: 'abort' };

export interface PullView {
  index: number;
  /** 1-based pull number for this boss, counting hidden pulls. */
  n: number;
  status: PullStatus;
  durationMs: number;
  bossHpPercent: number | null;
  /** Progress bar width: 100 for a kill, 100 − boss HP when known, else 0. */
  hpBarPercent: number;
  playerCount: number;
  startUnixMs: number;
}

export interface BossGroup {
  key: string;
  encounterId: number;
  name: string;
  /** Each difficulty of a boss is its own group: Heroic farm and Mythic progress differ. */
  difficulty: string;
  pullCount: number;
  killPull: number | null;
  killDurationMs: number | null;
  bestWipePercent: number | null;
  pulls: PullView[];
  /** `all`, `wipes` and `kills` of the visible pulls, each only with at least two pulls. */
  sets: PullSetView[];
}

export interface PullSetView {
  set: PullSet;
  durationMs: number;
}

/** A boss pull inside a Mythic+ run; `n` counts within the run, hidden pulls included. */
export interface RunPullView extends PullView {
  name: string;
}

/** A fight outside boss encounters, named after the enemy that took the most damage. */
export interface CombatPullView {
  index: number;
  name: string;
  /** Enemies fought besides the one the pull is named after. */
  moreEnemies: number;
  zone: string | null;
  status: PullStatus;
  /** A non-kill under 10 s: its time in seconds, hidden with the aborted pulls. */
  aborted: boolean;
  durationMs: number;
  playerCount: number;
  startUnixMs: number;
}

/** A boss pull of a run card, or the combat pulls between two of them; `after` is the index of the boss pull before them, or of the run. */
export type RunEntry = { kind: 'boss'; pull: RunPullView } | { kind: 'trash'; after: number; pulls: CombatPullView[] };

/** A Mythic+ run with its boss and combat pulls. */
export interface RunView {
  index: number;
  dungeon: string;
  keystoneLevel: number;
  affixIds: number[];
  status: RunStatus;
  /** From the dungeon data; `null` without it. */
  bosses: BossProgress | null;
  timer: KeyTimer | null;
  /** Logged key time (`CHALLENGE_MODE_END`, penalties included); `null` without an end or for an abandoned key's 0. */
  loggedMs: number | null;
  durationMs: number;
  playerCount: number;
  startUnixMs: number;
  /** Every boss pull of the run, hidden ones included; combat pulls do not count. */
  pullCount: number;
  /** In log order, the combat pulls between two boss pulls as one entry; aborted pulls are left out when hidden. */
  entries: RunEntry[];
}

export function isCombatPull<T extends Pick<FightRow, 'combat'>>(fight: T): fight is T & { combat: CombatInfo } {
  return fight.combat !== null;
}

/** A non-kill under 10 s: "Hide aborted pulls" hides it, a boss pull's or a combat pull's alike. */
export function isAborted(fight: Pick<FightRow, 'outcome' | 'durationMs'>): boolean {
  return fight.outcome !== 'kill' && fight.durationMs < ABORT_THRESHOLD_MS;
}

export function pullStatus(fight: FightRow): PullStatus {
  if (fight.outcome === 'kill') return 'kill';
  // A short combat pull keeps its logged result; only boss pulls are labelled aborted.
  if (!isCombatPull(fight) && isAborted(fight)) return 'aborted';
  if (fight.outcome === 'ended') return 'ended';
  return fight.outcome === 'incomplete' ? 'incomplete' : 'wipe';
}

export function moreEnemies(combat: CombatInfo): number {
  return Math.max(0, combat.enemyCount - 1);
}

/** `Venomfang Juggernaut +10`; the name alone when no other enemy was fought. */
export function combatName(name: string, more: number): string {
  return more > 0 ? t('combat.named', { name, more: t('combat.more', { count: more }) }) : name;
}

/** `Venomfang Juggernaut and 10 more enemies`: what assistive tech reads for `combatName`. */
export function spokenCombatName(name: string, more: number): string {
  return more > 0 ? t('combat.named', { name, more: t('combat.moreEnemies', { count: more }) }) : name;
}

/** An aborted pull lasts seconds: `0.4 s` instead of `0:00`. */
export function pullTime(durationMs: number, aborted: boolean): string {
  return aborted ? formatSeconds(durationMs) : formatDuration(durationMs);
}

/** A boss pull's time as shown, by default its whole length. */
export function pullViewTime(pull: PullView, durationMs = pull.durationMs): string {
  return pullTime(durationMs, pull.status === 'aborted');
}

export function runStatus(fight: FightRow): RunStatus {
  if (fight.outcome === 'kill') return 'completed';
  return fight.outcome === 'wipe' ? 'notCompleted' : 'incomplete';
}

/** Difficulty ID of Mythic+ keystone dungeons. */
const MYTHIC_PLUS_DIFFICULTY = 8;

/** What boss groups, sets and comparisons are made of: boss pulls outside Mythic+ runs. */
export function isGroupedBossPull(fight: FightRow): boolean {
  return fight.run === null && fight.runIndex === null && !isCombatPull(fight);
}

export function difficultyName(fight: Pick<FightRow, 'difficulty' | 'difficultyLabel'>): string {
  return fight.difficultyLabel ?? t('difficulty.unknown', { id: fight.difficulty });
}

/** Boss pulls outside Mythic+ runs, grouped by boss and difficulty; `groupRuns` lists the runs. */
export function groupPulls(fights: FightRow[], hideAborted: boolean): BossGroup[] {
  const groups = new Map<string, FightRow[]>();
  for (const fight of fights) {
    if (!isGroupedBossPull(fight)) continue;
    const key = `${fight.encounterId}:${fight.difficulty}`;
    const list = groups.get(key);
    if (list) list.push(fight);
    else groups.set(key, [fight]);
  }

  const result: BossGroup[] = [];
  for (const [key, list] of groups) {
    const views = list.map((fight, i) => toView(fight, i + 1));
    const kill = views.find((view) => view.status === 'kill') ?? null;
    const measured = views.filter(
      (view) => (view.status === 'wipe' || view.status === 'incomplete') && view.bossHpPercent !== null,
    );
    const pulls = hideAborted ? views.filter((view) => view.status !== 'aborted') : views;
    if (pulls.length === 0) continue;
    result.push({
      key,
      encounterId: list[0].encounterId,
      name: list[0].name,
      difficulty: difficultyName(list[0]),
      pullCount: list.length,
      killPull: kill?.n ?? null,
      killDurationMs: kill?.durationMs ?? null,
      bestWipePercent: measured.length > 0 ? Math.min(...measured.map((view) => view.bossHpPercent!)) : null,
      pulls,
      sets: pullSets(list[0], pulls),
    });
  }
  return result;
}

function pullSets(boss: Pick<FightRow, 'encounterId' | 'difficulty'>, pulls: PullView[]): PullSetView[] {
  const kinds: Record<PullSetKind, PullView[]> = {
    all: pulls,
    wipes: pulls.filter((pull) => pull.status !== 'kill'),
    kills: pulls.filter((pull) => pull.status === 'kill'),
  };
  return (Object.keys(kinds) as PullSetKind[])
    .filter((kind) => kinds[kind].length >= 2)
    .map((kind) => ({
      set: { kind, encounterId: boss.encounterId, difficulty: boss.difficulty, fights: kinds[kind].map((pull) => pull.index) },
      durationMs: kinds[kind].reduce((sum, pull) => sum + pull.durationMs, 0),
    }));
}

/** Combat pulls outside Mythic+ runs in log order; `groupRuns` lists those inside a run. */
export function combatPulls(fights: FightRow[], hideAborted: boolean): CombatPullView[] {
  return fights.filter(isCombatPull).filter((fight) => fight.runIndex === null && !(hideAborted && isAborted(fight))).map(toCombatView);
}

/** Mythic+ runs in log order, each with its boss pulls numbered within the run and the combat pulls between them. */
export function groupRuns(fights: FightRow[], hideAborted: boolean): RunView[] {
  return fights.flatMap((fight) => {
    const run = fight.run;
    if (run === null) return [];
    const numbered = runBossPulls(fights, fight.index);
    const entries: RunEntry[] = [];
    for (const pull of fights) {
      if (pull.runIndex !== fight.index || (hideAborted && isAborted(pull))) continue;
      const last = entries.at(-1);
      if (!isCombatPull(pull)) entries.push({ kind: 'boss', pull: { ...toView(pull, numbered.indexOf(pull) + 1), name: pull.name } });
      else if (last?.kind === 'trash') last.pulls.push(toCombatView(pull));
      else entries.push({ kind: 'trash', after: last?.pull.index ?? fight.index, pulls: [toCombatView(pull)] });
    }
    return [
      {
        index: fight.index,
        dungeon: fight.name,
        keystoneLevel: run.keystoneLevel,
        affixIds: run.affixIds,
        status: runStatus(fight),
        bosses: run.bosses,
        timer: run.timer,
        loggedMs: run.totalTimeMs || null,
        durationMs: fight.durationMs,
        playerCount: fight.playerCount,
        startUnixMs: fight.startUnixMs,
        pullCount: numbered.length,
        entries,
      },
    ];
  });
}

/**
 * What the dungeon data tells about a run, e.g. `In time +2` and `3/3 bosses`; nothing
 * without it, so no time is ever claimed from the log alone.
 */
export function runProgress(run: Pick<RunInfo, 'bosses' | 'timer'>): string[] {
  const timer =
    run.timer === null
      ? null
      : run.timer.kind === 'inTime'
        ? t('runs.inTime', { upgrades: formatInteger(run.timer.upgrades) })
        : t('runs.overTime');
  const bosses = run.bosses === null ? null : t('runs.bosses', { killed: formatInteger(run.bosses.killed), count: run.bosses.total });
  return [timer, bosses].filter((part): part is string => part !== null);
}

/** Subtitle of a run card, e.g. `3/3 bosses · 5 boss pulls · Affixes 10, 147, 9`; affix IDs stay raw until curated names exist. */
export function runSubtitle(run: RunView): string {
  return [
    run.bosses === null ? null : t('runs.bosses', { killed: formatInteger(run.bosses.killed), count: run.bosses.total }),
    t('runs.bossPulls', { count: run.pullCount }),
    run.affixIds.length > 0 ? t('runs.affixes', { ids: run.affixIds.join(', ') }) : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

/** The one time a run card shows: the logged key time when the log has one, else the fight's length. */
export function runTimeMs(run: Pick<RunView, 'durationMs' | 'loggedMs'>): number {
  return run.loggedMs ?? run.durationMs;
}

/**
 * Result chip of a run card, like a boss card's "Kill 6:05": `In time +1 · 30:59`, `Over time · 34:10`,
 * `Completed · 31:00` (no dungeon data), else the status alone. The time is the logged key time when
 * the log has one.
 */
export function runChipLabel(run: Pick<RunView, 'status' | 'timer' | 'durationMs' | 'loggedMs'>): string {
  if (run.status !== 'completed') return t(`runs.status.${run.status}`);
  const duration = formatDuration(runTimeMs(run));
  if (run.timer === null) return t('runs.chipCompleted', { duration });
  return run.timer.kind === 'inTime'
    ? t('runs.chipInTime', { upgrades: formatInteger(run.timer.upgrades), duration })
    : t('runs.chipOverTime', { duration });
}

function toView(fight: FightRow, n: number): PullView {
  const status = pullStatus(fight);
  const hpKnown = fight.bossHpPercent !== null && status !== 'aborted';
  return {
    index: fight.index,
    n,
    status,
    durationMs: fight.durationMs,
    bossHpPercent: status === 'aborted' ? null : fight.bossHpPercent,
    hpBarPercent: status === 'kill' ? 100 : hpKnown ? 100 - fight.bossHpPercent! : 0,
    playerCount: fight.playerCount,
    startUnixMs: fight.startUnixMs,
  };
}

function toCombatView(fight: FightRow & { combat: CombatInfo }): CombatPullView {
  return {
    index: fight.index,
    name: fight.name,
    moreEnemies: moreEnemies(fight.combat),
    zone: fight.zone,
    status: pullStatus(fight),
    aborted: isAborted(fight),
    durationMs: fight.durationMs,
    playerCount: fight.playerCount,
    startUnixMs: fight.startUnixMs,
  };
}

/** Key of saved ranges: per boss and difficulty, per dungeon for a Mythic+ run; `null` for a combat pull, which keeps none. */
export function rangeKey(fight: FightRow): string | null {
  if (isCombatPull(fight)) return null;
  return fight.run ? `run:${fight.run.challengeModeId}` : `${fight.encounterId}:${fight.difficulty}`;
}
/** Pulls of one boss and difficulty outside Mythic+, numbered as in the pull list (hidden pulls count). */
function bossPulls(fights: FightRow[], boss: Pick<FightRow, 'encounterId' | 'difficulty'>): PullView[] {
  return fights
    .filter((fight) => isGroupedBossPull(fight) && fight.encounterId === boss.encounterId && fight.difficulty === boss.difficulty)
    .map((fight, i) => toView(fight, i + 1));
}

function runBossPulls(fights: FightRow[], runIndex: number): FightRow[] {
  return fights.filter((fight) => fight.runIndex === runIndex && !isCombatPull(fight));
}

/** A boss pull's number among its boss's pulls, or among the boss pulls of its run (hidden pulls count); `null` for runs and combat pulls. */
export function pullNumber(fights: FightRow[], row: FightRow): number | null {
  if (row.run !== null || isCombatPull(row)) return null;
  if (row.runIndex === null) return pullView(fights, row.index)?.n ?? null;
  const at = runBossPulls(fights, row.runIndex).findIndex((fight) => fight.index === row.index);
  return at === -1 ? null : at + 1;
}

/** The pull with log index `index`, numbered as in the pull list; `null` if the log has none. */
export function pullView(fights: FightRow[], index: number): PullView | null {
  const fight = fights.find((candidate) => candidate.index === index);
  if (!fight) return null;
  return bossPulls(fights, fight).find((view) => view.index === index) ?? null;
}

/**
 * Pulls `current` can be compared with: same boss and difficulty, not aborted, not itself.
 * Comparison stays with boss pulls outside Mythic+, so runs, their boss pulls and combat pulls get none.
 */
export function comparablePulls(fights: FightRow[], current: FightRow): PullView[] {
  // Mythic+ boss pulls stay out, also when their run is missing (logging started mid-key).
  if (!isGroupedBossPull(current) || current.difficulty === MYTHIC_PLUS_DIFFICULTY) return [];
  return bossPulls(fights, current).filter((view) => view.index !== current.index && view.status !== 'aborted');
}
