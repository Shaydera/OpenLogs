import type { Dimension, Side } from './api/types';
import type { MessageKey } from './i18n/i18n';

type UnitDimension = 'source' | 'target';

/** How a tab reads the page filters; mirrors the core's per-metric sides. */
export interface TabSides {
  /** The dimension that holds the perspective's side. */
  own: UnitDimension;
  /** The dimension that holds the side it faces; `null` when the tab has none. */
  other: UnitDimension | null;
  /** The Rows menu, the default grouping first; empty for a plain list. */
  rows: Dimension[];
  captions: Record<Dimension, MessageKey>;
  /** The other side's "All …" entry per perspective. */
  otherAll: Record<Side, MessageKey>;
  /** Whether the other side's picker sorts players into role sections per perspective. */
  otherByRole: Record<Side, boolean>;
}

export type FilterTab = 'damage' | 'healing' | 'taken';

const UNITS = { source: 'scope.source', target: 'scope.target', ability: 'scope.ability' } as const satisfies Record<Dimension, MessageKey>;

export const SIDES: Record<FilterTab, TabSides> = {
  damage: {
    own: 'source',
    other: 'target',
    rows: ['source', 'ability', 'target'],
    captions: UNITS,
    otherAll: { friendly: 'scope.allEnemies', enemy: 'scope.allFriendlies' },
    otherByRole: { friendly: false, enemy: true },
  },
  healing: {
    own: 'source',
    other: 'target',
    rows: ['source', 'ability', 'target'],
    captions: UNITS,
    otherAll: { friendly: 'scope.allFriendlies', enemy: 'scope.allEnemies' },
    otherByRole: { friendly: true, enemy: false },
  },
  taken: {
    own: 'target',
    other: 'source',
    rows: ['target', 'ability', 'source'],
    captions: { ...UNITS, target: 'scope.takenBy' },
    otherAll: { friendly: 'scope.allSources', enemy: 'scope.allFriendlies' },
    otherByRole: { friendly: false, enemy: true },
  },
};

export const isFilterTab = (tab: string): tab is FilterTab => Object.hasOwn(SIDES, tab);
