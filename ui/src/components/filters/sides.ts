import type { Dimension, Side } from '../../api/types';
import { t } from '../../i18n/i18n';
import { type FilterTab, SIDES } from '../../scopeSides';

/** Whether a unit picker sorts players into role sections; otherwise they are "Other sources". */
export function holdsFriendlies(tab: FilterTab, dimension: Dimension, side: Side): boolean {
  if (dimension === SIDES[tab].own) return side === 'friendly';
  return SIDES[tab].otherByRole[side];
}

export function allLabel(tab: FilterTab, dimension: Dimension, side: Side): string {
  if (dimension === 'ability') return t('scope.allAbilities');
  if (dimension === SIDES[tab].own) return t(side === 'friendly' ? 'scope.allFriendlies' : 'scope.allEnemies');
  return t(SIDES[tab].otherAll[side]);
}

export const captionOf = (tab: FilterTab, dimension: Dimension): string => t(SIDES[tab].captions[dimension]);
