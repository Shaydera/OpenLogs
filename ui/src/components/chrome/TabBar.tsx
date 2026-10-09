import { type KeyboardEvent, useRef } from 'react';
import { useFocusRequest } from '../../hooks/useFocusRequest';
import { type MessageKey, t } from '../../i18n/i18n';
import { type FightTab, useApp } from '../../store';
import { AttributionToggle } from '../reports/AttributionToggle';
import { tabBarControl } from './tabBarControl';

const TABS: { key: MessageKey; tab: FightTab }[] = [
  { key: 'tabs.overview', tab: 'overview' },
  { key: 'tabs.damageDone', tab: 'damage' },
  { key: 'tabs.healing', tab: 'healing' },
  { key: 'tabs.damageTaken', tab: 'taken' },
];

/** The one panel every tab controls; its content follows the selected tab. */
export const PANEL_ID = 'fight-tabpanel';
export const tabId = (tab: FightTab) => `fight-tab-${tab}`;

/** WAI-ARIA tab keys: arrows wrap around, Home and End jump to the ends. */
function nextTab(current: FightTab, key: string): FightTab | null {
  const index = TABS.findIndex((entry) => entry.tab === current);
  const target =
    key === 'ArrowRight' ? index + 1 : key === 'ArrowLeft' ? index - 1 : key === 'Home' ? 0 : key === 'End' ? TABS.length - 1 : null;
  return target === null ? null : TABS[(target + TABS.length) % TABS.length].tab;
}

/** The fight's tab row with its control at the right end (`tabBarControl`). */
export function TabBar() {
  const tab = useApp((s) => s.tab);
  const details = useApp((s) => s.details);
  const setTab = useApp((s) => s.setTab);
  const tabRefs = useRef<Map<FightTab, HTMLButtonElement>>(new Map());
  useFocusRequest('tab', () => tabRefs.current.get(tab));
  const control = tabBarControl(tab, details);

  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    const target = nextTab(tab, event.key);
    if (!target) return;
    event.preventDefault();
    tabRefs.current.get(target)?.focus();
    // Home on the first tab or End on the last only moves focus; selecting again would reload it.
    if (target !== tab) void setTab(target);
  }

  return (
    <div className="tabbar">
      <div className="tabs" role="tablist" aria-label={t('tabs.label')} onKeyDown={onTabKey}>
        {TABS.map((entry) => {
          const selected = entry.tab === tab;
          return (
            <button
              key={entry.key}
              ref={(element) => {
                if (element) tabRefs.current.set(entry.tab, element);
                else tabRefs.current.delete(entry.tab);
              }}
              id={tabId(entry.tab)}
              type="button"
              role="tab"
              className={selected ? 'tab on' : 'tab'}
              aria-selected={selected}
              aria-controls={selected ? PANEL_ID : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => void setTab(entry.tab)}
            >
              {t(entry.key)}
            </button>
          );
        })}
      </div>
      {control === 'aug' && <AttributionToggle />}
    </div>
  );
}
