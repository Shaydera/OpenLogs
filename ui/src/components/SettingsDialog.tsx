import { type KeyboardEvent, useEffect, useId, useRef } from 'react';
import type { GameDataStatus, TableStatus } from '../api/types';
import { formatLocalDate } from '../i18n/format';
import { type MessageKey, t } from '../i18n/i18n';
import { useApp } from '../store';
import { THEMES, type ThemeName } from '../theme';
import { ThemeSwitch } from './chrome/ThemeSwitch';

const TABLES: { key: keyof Omit<GameDataStatus, 'refreshing'>; name: MessageKey; entries: MessageKey }[] = [
  { key: 'spellIcons', name: 'settings.spellIcons', entries: 'settings.entries.spellIcons' },
  { key: 'dungeons', name: 'settings.dungeons', entries: 'settings.entries.dungeons' },
  { key: 'bossPortraits', name: 'settings.bossPortraits', entries: 'settings.entries.bossPortraits' },
];

const THEME_TEXT: Record<ThemeName, { name: MessageKey; hint: MessageKey }> = {
  slate: { name: 'theme.slate', hint: 'theme.slateHint' },
  bark: { name: 'theme.bark', hint: 'theme.barkHint' },
};

/** How often the dialog asks for the status while a sync runs. */
const POLL_MS = 2000;

function statusLine(status: TableStatus, entries: MessageKey): string {
  return [
    status.entries !== null ? t(entries, { count: status.entries }) : t('settings.notLoaded'),
    status.fetchedUnixMs !== null ? t('settings.updated', { date: formatLocalDate(status.fetchedUnixMs) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The persisted preferences and the game-data status with "Refresh now". */
export function SettingsDialog() {
  const closeSettings = useApp((s) => s.closeSettings);
  const hideAborted = useApp((s) => s.hideAborted);
  const setHideAborted = useApp((s) => s.setHideAborted);
  const hideProcs = useApp((s) => s.hideProcs);
  const setHideProcs = useApp((s) => s.setHideProcs);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const showAugDelta = useApp((s) => s.showAugDelta);
  const setShowAugDelta = useApp((s) => s.setShowAugDelta);
  const gameData = useApp((s) => s.gameData);
  const loading = useApp((s) => s.gameDataLoading);
  const requested = useApp((s) => s.gameDataRefreshing);
  const loadStatus = useApp((s) => s.loadGameDataStatus);
  const refresh = useApp((s) => s.refreshGameData);
  const closeRef = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  const backendBusy = gameData?.refreshing ?? false;
  const refreshing = requested || backendBusy;
  // Until the first status answers, a sync may already run (app start): offer nothing to start yet.
  const unknown = gameData === null && loading;

  // Focus moves into the dialog and back to where it came from (the Settings button).
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);

  // A sync started elsewhere (app start, an earlier click): follow it until it ends.
  useEffect(() => {
    if (!backendBusy) return;
    const timer = setInterval(() => void loadStatus(), POLL_MS);
    return () => clearInterval(timer);
  }, [backendBusy, loadStatus]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    closeSettings();
  }

  return (
    <div
      className="modal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeSettings();
      }}
    >
      <section className="panel settings" role="dialog" aria-modal="true" aria-labelledby="settings-title" onKeyDown={onKeyDown}>
        <div className="panel-head">
          <h2 id="settings-title" className="h2">
            {t('settings.title')}
          </h2>
          <button ref={closeRef} type="button" className="btn" onClick={closeSettings}>
            {t('settings.close')}
          </button>
        </div>
        <div className="settings-body">
          <h3 className="cap settings-label">{t('theme.title')}</h3>
          <fieldset className="theme-choices">
            <legend className="sr-only">{t('theme.theme')}</legend>
            {THEMES.map((name) => (
              <label key={name} className={name === theme ? 'theme-choice theme-choice-on' : 'theme-choice'}>
                <input
                  type="radio"
                  name="theme"
                  value={name}
                  checked={name === theme}
                  aria-describedby={`${hintId}-${name}`}
                  onChange={() => setTheme(name)}
                />
                <span className="theme-choice-name">{t(THEME_TEXT[name].name)}</span>
                {/* Out of the radio's name; read as its description instead. */}
                <span id={`${hintId}-${name}`} className="theme-choice-hint" aria-hidden="true">
                  {t(THEME_TEXT[name].hint)}
                </span>
              </label>
            ))}
          </fieldset>
          <div className="settings-mode">
            <span>{t('theme.mode')}</span>
            <ThemeSwitch labelled />
          </div>
          <h3 className="cap settings-label">{t('settings.preferences')}</h3>
          <label className="toggle">
            <input type="checkbox" checked={hideAborted} onChange={(event) => setHideAborted(event.target.checked)} />
            {t('pulls.hideAborted')}
          </label>
          <label className="toggle">
            <input type="checkbox" checked={hideProcs} onChange={(event) => setHideProcs(event.target.checked)} />
            {t('casts.hideProcs')}
          </label>
          <label className="toggle">
            <input type="checkbox" checked={showAugDelta} onChange={(event) => setShowAugDelta(event.target.checked)} />
            {t('aug.showDelta')}
          </label>
          <h3 className="cap settings-label">{t('settings.gameData')}</h3>
          {gameData === null ? (
            <p className="settings-note">{loading ? t('settings.loading') : t('settings.statusUnavailable')}</p>
          ) : (
            <ul className="settings-tables">
              {TABLES.map((table) => {
                const status = gameData[table.key];
                return (
                  <li key={table.key}>
                    <span>{t(table.name)}</span>
                    <span className="settings-status">{statusLine(status, table.entries)}</span>
                    {status.error && <span className="settings-error">{t('settings.failed', { reason: status.error })}</span>}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="settings-actions">
            <span className="settings-note">{t('settings.hint')}</span>
            <button type="button" className="btn" disabled={refreshing || unknown} onClick={() => void refresh()}>
              {refreshing ? t('settings.refreshing') : t('settings.refresh')}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
