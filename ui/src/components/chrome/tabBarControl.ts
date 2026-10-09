import type { Detail } from '../../api/types';
import type { FightTab } from '../../store';

type TabBarControl = 'aug' | null;

/**
 * The control at the right end of the tab row: the Aug toggle on Overview, Damage Done, Healing and a
 * player page, nothing elsewhere.
 */
export function tabBarControl(tab: FightTab, details: Detail[]): TabBarControl {
  const top = details[details.length - 1];
  if (top) return top.kind === 'player' ? 'aug' : null;
  return tab === 'overview' || tab === 'damage' || tab === 'healing' ? 'aug' : null;
}
