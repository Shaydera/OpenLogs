import type { PlayerRef, TargetRef, TargetShare } from '../../api/types';
import { t } from '../../i18n/i18n';
import { classColor, shortName } from '../overview/players';

export type TargetMetric = 'damage' | 'healing';

/** A colour group of the target split: one of the raid's largest enemy groups, a healed player's role, or "Other". */
export interface TargetGroup {
  key: string;
  label: string;
  color: string;
}

const OTHER = 'other';
const ENEMY_COLORS = ['var(--target-1)', 'var(--target-2)', 'var(--target-3)', 'var(--target-4)'];
const OTHER_GROUP = (): TargetGroup => ({ key: OTHER, label: t('targets.other'), color: 'var(--target-other)' });

/** The legend in order: damage — the raid's largest enemy groups; healing — the roles of the healed players. */
export function targetGroups(metric: TargetMetric, colorGroups: string[]): TargetGroup[] {
  if (metric === 'healing') {
    return [
      { key: 'role:tank', label: t('targets.tanks'), color: 'var(--role-tank)' },
      { key: 'role:healer', label: t('targets.healers'), color: 'var(--role-healer)' },
      { key: 'role:damage', label: t('targets.dps'), color: 'var(--role-dps)' },
      OTHER_GROUP(),
    ];
  }
  return [...colorGroups.map((name, i) => ({ key: enemyGroupKey(name), label: name, color: ENEMY_COLORS[i] })), OTHER_GROUP()];
}

/** The key of an enemy colour group by its name; `null` is "Other". */
export function enemyGroupKey(name: string | null): string {
  return name === null ? OTHER : `unit:${name}`;
}

/** The group a target belongs to; healed players without a known role and every non-player are "Other". */
function groupKey(target: TargetRef, metric: TargetMetric, colorGroups: string[], roster: Map<number, PlayerRef>): string {
  if (metric === 'healing') {
    const role = target.player === null ? null : roster.get(target.player)?.role;
    return role ? `role:${role}` : OTHER;
  }
  return enemyGroupKey(target.kind === 'unit' && colorGroups.includes(target.name) ? target.name : null);
}

/** A metric's colour groups and how a target finds its group and colour. */
export function targetColors(metric: TargetMetric, colorGroups: string[], roster: Map<number, PlayerRef>) {
  const groups = targetGroups(metric, colorGroups);
  const keyOf = (target: TargetRef) => groupKey(target, metric, colorGroups, roster);
  const colorOf = (target: TargetRef) => groups.find((group) => group.key === keyOf(target))?.color ?? OTHER_GROUP().color;
  return { groups, keyOf, colorOf };
}

export interface GroupPart {
  group: TargetGroup;
  amount: number;
  absorbed: number;
  healAbsorbed: number;
  /** The group's targets, largest first. */
  targets: TargetShare[];
}

/** Targets summed by group, in legend order; groups without a positive amount are left out. */
export function splitByGroup(targets: TargetShare[], groups: TargetGroup[], keyOf: (target: TargetRef) => string): GroupPart[] {
  const parts = new Map<string, GroupPart>(groups.map((group) => [group.key, { group, amount: 0, absorbed: 0, healAbsorbed: 0, targets: [] }]));
  for (const share of targets) {
    const part = parts.get(keyOf(share.target)) ?? parts.get(OTHER);
    if (!part) continue;
    part.amount += share.amount;
    part.absorbed += share.absorbed;
    part.healAbsorbed += share.healAbsorbed;
    part.targets.push(share);
  }
  return [...parts.values()].filter((part) => part.amount > 0);
}

/** A target as the lists name it: the unit's name, a player's short name, or "Unknown". */
export function targetName(target: TargetRef, roster: Map<number, PlayerRef>): string {
  if (target.kind === 'unit') return target.name;
  if (target.kind === 'player' && target.player !== null) {
    const player = roster.get(target.player);
    return player ? shortName(player.name) : t('report.unknownPlayer');
  }
  return t('targets.unknown');
}

/** " · 58 units" for a target that stands for several units. */
export function unitsNote(target: TargetRef): string {
  return target.units > 1 ? ` · ${t('targets.units', { count: target.units })}` : '';
}

/** A healed player's class colour for their bar, else `null`. */
export function playerColor(target: TargetRef, roster: Map<number, PlayerRef>): string | null {
  if (target.kind !== 'player' || target.player === null) return null;
  return classColor(roster.get(target.player)?.classToken ?? null);
}
