import type { FightRow, PullSet } from '../api/types';
import type { View } from '../store';
import { isAborted, isCombatPull, isGroupedBossPull, moreEnemies, pullNumber, pullStatus, runStatus, type PullStatus, type RunStatus } from './groupPulls';

export interface FollowUpdate {
  /** Pull or run the view moves to; `null` = stay. */
  jumpTo: number | null;
  /** The open set with vanished pulls removed, changed ones checked again and new matching ones added; `null` = unchanged or no set open. */
  set: PullSet | null;
  /** The shown pull is no longer listed (an in-progress pull hidden once the log grows). */
  shownVanished: boolean;
}

export type LiveNotice =
  | { kind: 'pull'; n: number; status: PullStatus; bossHpPercent: number | null }
  | { kind: 'combat'; name: string; moreEnemies: number; status: PullStatus }
  | { kind: 'run'; dungeon: string; keystoneLevel: number; status: RunStatus };

/** Follows only to rows of the kind shown, or to any while the shown row is unknown: reading a boss pull, new trash never pulls the view away. */
export function followUpdate(before: FightRow[], after: FightRow[], view: View, hideAborted: boolean, comparing: boolean): FollowUpdate {
  const known = new Map(before.map((fight) => [fight.index, fight]));
  const isNew = (fight: FightRow) => {
    const old = known.get(fight.index);
    return old === undefined || old.outcome !== fight.outcome || old.durationMs !== fight.durationMs;
  };
  const isVisible = (fight: FightRow) => fight.run !== null || !(hideAborted && isAborted(fight));
  const arrived = after.filter((fight) => isNew(fight) && isVisible(fight));

  let jumpTo: number | null = null;
  if (view.kind === 'fight' && !comparing) {
    const shownRow = known.get(view.fightIndex);
    const combatShown = shownRow !== undefined && isCombatPull(shownRow);
    const ofShownKind = (fight: FightRow) => isCombatPull(fight) === combatShown;
    const newestShown = newest(before.filter((fight) => isVisible(fight) && ofShownKind(fight)));
    // A run is numbered before its boss pulls, so the newest row may be the last boss pull of the shown run.
    const onNewest = newestShown !== null && (view.fightIndex === newestShown.index || view.fightIndex === newestShown.runIndex);
    if (onNewest || shownRow === undefined) {
      const candidates = shownRow === undefined ? arrived : arrived.filter(ofShownKind);
      const target = candidates.find((fight) => fight.run !== null) ?? newest(candidates);
      jumpTo = target?.index ?? null;
    }
  }

  const present = new Set(after.map((fight) => fight.index));
  const shownVanished = view.kind === 'fight' && jumpTo === null && known.has(view.fightIndex) && !present.has(view.fightIndex);

  const unchanged = new Set(after.filter((fight) => !isNew(fight)).map((fight) => fight.index));
  return { jumpTo, set: view.kind === 'set' ? grownSet(view.set, unchanged, arrived) : null, shownVanished };
}

function newest(fights: FightRow[]): FightRow | null {
  return fights.reduce<FightRow | null>((best, fight) => (best === null || fight.index > best.index ? fight : best), null);
}

/** A pull that changed leaves the set like a vanished one and comes back with the arrivals if it still fits. */
function grownSet(set: PullSet, unchanged: Set<number>, arrived: FightRow[]): PullSet | null {
  const kept = set.fights.filter((index) => unchanged.has(index));
  const added = arrived
    .filter(
      (fight) =>
        isGroupedBossPull(fight) &&
        fight.encounterId === set.encounterId &&
        fight.difficulty === set.difficulty &&
        (set.kind === 'kills' ? pullStatus(fight) === 'kill' : set.kind === 'wipes' ? pullStatus(fight) !== 'kill' : true),
    )
    .map((fight) => fight.index);
  if (kept.length === set.fights.length && added.length === 0) return null;
  return { ...set, fights: [...kept, ...added].sort((a, b) => a - b) };
}

export function liveNoticeOf(fights: FightRow[], index: number): LiveNotice {
  const fight = fights.find((candidate) => candidate.index === index);
  if (!fight) throw new Error(`No pull with index ${index}`);
  if (fight.run !== null) {
    return { kind: 'run', dungeon: fight.name, keystoneLevel: fight.run.keystoneLevel, status: runStatus(fight) };
  }
  if (isCombatPull(fight)) return { kind: 'combat', name: fight.name, moreEnemies: moreEnemies(fight.combat), status: pullStatus(fight) };
  return { kind: 'pull', n: pullNumber(fights, fight)!, status: pullStatus(fight), bossHpPercent: fight.bossHpPercent };
}
