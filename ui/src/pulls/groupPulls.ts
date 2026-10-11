import type { FightRow } from '../api/types';
import { t } from '../i18n/i18n';

/** Non-kills shorter than this are "aborted" and can be hidden. */
const ABORT_THRESHOLD_MS = 10_000;

export type PullStatus = 'kill' | 'wipe' | 'aborted' | 'incomplete';

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
}

export function pullStatus(fight: FightRow): PullStatus {
  if (fight.outcome === 'kill') return 'kill';
  if (fight.durationMs < ABORT_THRESHOLD_MS) return 'aborted';
  return fight.outcome === 'incomplete' ? 'incomplete' : 'wipe';
}

export function difficultyName(fight: Pick<FightRow, 'difficulty' | 'difficultyLabel'>): string {
  return fight.difficultyLabel ?? t('difficulty.unknown', { id: fight.difficulty });
}

export function groupPulls(fights: FightRow[], hideAborted: boolean): BossGroup[] {
  const groups = new Map<string, FightRow[]>();
  for (const fight of fights) {
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
    });
  }
  return result;
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

/** Pulls of one boss and difficulty, numbered as in the pull list (hidden pulls count). */
function bossPulls(fights: FightRow[], boss: Pick<FightRow, 'encounterId' | 'difficulty'>): PullView[] {
  return fights
    .filter((fight) => fight.encounterId === boss.encounterId && fight.difficulty === boss.difficulty)
    .map((fight, i) => toView(fight, i + 1));
}

/** The pull with log index `index`, numbered as in the pull list; `null` if the log has none. */
export function pullView(fights: FightRow[], index: number): PullView | null {
  const fight = fights.find((candidate) => candidate.index === index);
  if (!fight) return null;
  return bossPulls(fights, fight).find((view) => view.index === index) ?? null;
}

/** Pulls `current` can be compared with: same boss and difficulty, not aborted, not itself. */
export function comparablePulls(fights: FightRow[], current: FightRow): PullView[] {
  return bossPulls(fights, current).filter((view) => view.index !== current.index && view.status !== 'aborted');
}
