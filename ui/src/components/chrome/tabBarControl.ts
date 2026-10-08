import type { FightTab } from '../../store';

type TabBarControl = 'aug' | null;

/** The control at the right end of the tab row: the Aug toggle on Overview, Damage Done and Healing, nothing elsewhere. */
export function tabBarControl(tab: FightTab): TabBarControl {
  return tab === 'overview' || tab === 'damage' || tab === 'healing' ? 'aug' : null;
}
