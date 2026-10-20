import { type MessageKey, t } from '../../i18n/i18n';
import type { FightTab } from '../../store';

export type TabEntry = { key: MessageKey; tab: FightTab };

/** The fight's tabs in their order, the Replay tab last. */
export const TABS: TabEntry[] = [
  { key: 'tabs.overview', tab: 'overview' },
  { key: 'tabs.damageDone', tab: 'damage' },
  { key: 'tabs.healing', tab: 'healing' },
  { key: 'tabs.damageTaken', tab: 'taken' },
  { key: 'tabs.deaths', tab: 'deaths' },
  { key: 'tabs.buffs', tab: 'buffs' },
  { key: 'tabs.casts', tab: 'casts' },
  { key: 'tabs.interrupts', tab: 'interrupts' },
  { key: 'tabs.resources', tab: 'resources' },
  { key: 'tabs.replay', tab: 'replay' },
];

export const tabLabel = (tab: FightTab) => t(TABS.find((entry) => entry.tab === tab)!.key);
