import type { Detail } from '../../api/types';
import type { FightTab } from '../../store';

type TabBarControl = 'aug' | 'procs' | null;

/**
 * The control at the right end of the tab row: the Aug toggle on Overview, Damage Done, Healing and a
 * player page, "Hide procs" on Casts, nothing elsewhere.
 */
export function tabBarControl(tab: FightTab, details: Detail[]): TabBarControl {
  const top = details[details.length - 1];
  if (top) return top.kind === 'player' ? 'aug' : null;
  if (tab === 'overview' || tab === 'damage' || tab === 'healing') return 'aug';
  return tab === 'casts' ? 'procs' : null;
}
