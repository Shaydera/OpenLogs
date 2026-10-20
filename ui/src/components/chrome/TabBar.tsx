import { type KeyboardEvent, type ReactNode, useId, useRef } from 'react';
import { useFocusRequest } from '../../hooks/useFocusRequest';
import { t } from '../../i18n/i18n';
import { type FightTab, replayOffered, tabOffered, useApp } from '../../store';
import { TABS, type TabEntry } from './fightTabs';

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

const replayIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.5" y="4" width="9" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M10.5 7 L14.5 4.8 V11.2 L10.5 9 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);

/**
 * The fight's tab row: `lead` at its start, then the tabs with the Replay tab last; a whole Mythic+ run
 * has no replay. A pull set keeps the tabs it has not visible and focusable, disabled with the reason.
 */
export function TabBar({ lead }: { lead?: ReactNode }) {
  const tab = useApp((s) => s.tab);
  const log = useApp((s) => s.log);
  const view = useApp((s) => s.view);
  const withReplay = useApp(replayOffered);
  const tabs = withReplay || view.kind === 'set' ? TABS : TABS_WITHOUT_REPLAY;
  const offered = (entry: FightTab) => tabOffered({ log, view }, entry);
  const setTab = useApp((s) => s.setTab);
  const tabRefs = useRef<Map<FightTab, HTMLButtonElement>>(new Map());
  const reasonId = useId();
  useFocusRequest('tab', () => tabRefs.current.get(tab));

  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    // Focus can rest on a disabled tab, which never becomes the selected one.
    const focused = tabs.find((entry) => tabRefs.current.get(entry.tab) === event.target)?.tab ?? tab;
    const target = nextTab(tabs, focused, event.key);
    if (!target) return;
    event.preventDefault();
    tabRefs.current.get(target)?.focus();
    // Home on the first tab or End on the last only moves focus; selecting again would reload it.
    if (target !== tab && offered(target)) void setTab(target);
  }

  const anyDisabled = tabs.some((entry) => !offered(entry.tab));
  return (
    <div className="tabbar">
      {lead}
      <div className="tabs" role="tablist" aria-label={t('tabs.label')} onKeyDown={onTabKey}>
        {tabs.map((entry) => {
          const selected = entry.tab === tab;
          const replay = entry.tab === 'replay';
          const disabled = !offered(entry.tab);
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
              className={['tab', replay && 'tab-replay', selected && 'on'].filter(Boolean).join(' ')}
              aria-selected={selected}
              aria-controls={selected ? PANEL_ID : undefined}
              aria-disabled={disabled || undefined}
              aria-describedby={disabled ? reasonId : undefined}
              title={disabled ? t('tabs.singlePullOnly') : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => !disabled && void setTab(entry.tab)}
            >
              {replay && replayIcon}
              {t(entry.key)}
            </button>
          );
        })}
      </div>
      {anyDisabled && (
        <span id={reasonId} className="sr-only">
          {t('tabs.singlePullOnly')}
        </span>
      )}
    </div>
  );
}
