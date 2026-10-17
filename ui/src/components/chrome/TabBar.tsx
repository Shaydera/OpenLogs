import { type KeyboardEvent, useRef } from 'react';
import { useFocusRequest } from '../../hooks/useFocusRequest';
import { type MessageKey, t } from '../../i18n/i18n';
import { type FightTab, replayOffered, useApp } from '../../store';
import { OptionsMenu } from './OptionsMenu';
import { ViewSwitch } from './ViewSwitch';

type TabEntry = { key: MessageKey; tab: FightTab };

const TABS: TabEntry[] = [
  { key: 'tabs.overview', tab: 'overview' },
  { key: 'tabs.damageDone', tab: 'damage' },
  { key: 'tabs.healing', tab: 'healing' },
  { key: 'tabs.damageTaken', tab: 'taken' },
  { key: 'tabs.deaths', tab: 'deaths' },
  { key: 'tabs.buffs', tab: 'buffs' },
  { key: 'tabs.casts', tab: 'casts' },
  { key: 'tabs.replay', tab: 'replay' },
  { key: 'tabs.interrupts', tab: 'interrupts' },
  { key: 'tabs.resources', tab: 'resources' },
];

/** The one panel every tab controls; its content follows the selected tab. */
export const PANEL_ID = 'fight-tabpanel';
export const tabId = (tab: FightTab) => `fight-tab-${tab}`;

const TABS_WITHOUT_REPLAY = TABS.filter((entry) => entry.tab !== 'replay');

/** WAI-ARIA tab keys: arrows wrap around, Home and End jump to the ends. */
function nextTab(tabs: TabEntry[], current: FightTab, key: string): FightTab | null {
  const index = tabs.findIndex((entry) => entry.tab === current);
  const target =
    key === 'ArrowRight' ? index + 1 : key === 'ArrowLeft' ? index - 1 : key === 'Home' ? 0 : key === 'End' ? tabs.length - 1 : null;
  return target === null ? null : tabs[(target + tabs.length) % tabs.length].tab;
}

/** The fight's tab row with the options menu, view switch and replay toggle at the right end; the replay has none of them, a whole Mythic+ run no replay. */
export function TabBar() {
  const tab = useApp((s) => s.tab);
  const withReplay = useApp(replayOffered);
  const tabs = withReplay ? TABS : TABS_WITHOUT_REPLAY;
  const setTab = useApp((s) => s.setTab);
  const split = useApp((s) => s.replay.split);
  const setReplaySplit = useApp((s) => s.setReplaySplit);
  const tabRefs = useRef<Map<FightTab, HTMLButtonElement>>(new Map());
  useFocusRequest('tab', () => tabRefs.current.get(tab));

  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    const target = nextTab(tabs, tab, event.key);
    if (!target) return;
    event.preventDefault();
    tabRefs.current.get(target)?.focus();
    // Home on the first tab or End on the last only moves focus; selecting again would reload it.
    if (target !== tab) void setTab(target);
  }

  return (
    <div className="tabbar">
      <div className="tabs" role="tablist" aria-label={t('tabs.label')} onKeyDown={onTabKey}>
        {tabs.map((entry) => {
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
      {tab !== 'replay' && (
        <div className="tab-tools">
          <OptionsMenu />
          <ViewSwitch />
          {withReplay && (
            <button type="button" className={split ? 'split-toggle on' : 'split-toggle'} aria-pressed={split} onClick={() => setReplaySplit(!split)}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <path d="M8 2.5 V13.5" stroke="currentColor" strokeWidth="1.4" />
              </svg>
              {t('replay.alongside')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
