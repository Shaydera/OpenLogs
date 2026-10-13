import type { Dimension, Side } from '../../api/types';
import { t } from '../../i18n/i18n';
import { ownDimension } from '../../scopeSides';
import type { MetricTab } from '../../store';

/** Whether a unit picker lists the friendly side (Healing's other side is the healer's own side). */
export function holdsFriendlies(tab: MetricTab, dimension: Dimension, side: Side): boolean {
  const friendly = side === 'friendly';
  return dimension === ownDimension(tab) || tab === 'healing' ? friendly : !friendly;
}

export function allLabel(tab: MetricTab, dimension: Dimension, side: Side): string {
  if (dimension === 'ability') return t('scope.allAbilities');
  const own = dimension === ownDimension(tab);
  const friendly = side === 'friendly';
  if (own) return t(friendly ? 'scope.allFriendlies' : 'scope.allEnemies');
  if (tab === 'healing') return t(friendly ? 'scope.allFriendlies' : 'scope.allEnemies');
  if (tab === 'taken') return t(friendly ? 'scope.allSources' : 'scope.allFriendlies');
  return t(friendly ? 'scope.allEnemies' : 'scope.allFriendlies');
}

export function captionOf(tab: MetricTab, dimension: Dimension): string {
  if (dimension === 'ability') return t('scope.ability');
  if (tab === 'taken') return t(dimension === 'target' ? 'scope.takenBy' : 'scope.source');
  return t(dimension === 'source' ? 'scope.source' : 'scope.target');
}
