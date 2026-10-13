import { type KeyboardEvent, useEffect, useId, useRef } from 'react';
import type { GameDataManifest } from '../gameData';
import { formatLocalDate } from '../i18n/format';
import { type MessageKey, t } from '../i18n/i18n';
import { useApp } from '../store';
import { THEMES, type ThemeName } from '../theme';

const TABLES: { key: keyof Omit<GameDataManifest, 'fetchedUnixMs'>; name: MessageKey; entries: MessageKey }[] = [
  { key: 'spellIcons', name: 'settings.spellIcons', entries: 'settings.entries.spellIcons' },
  { key: 'dungeons', name: 'settings.dungeons', entries: 'settings.entries.dungeons' },
  { key: 'bossPortraits', name: 'settings.bossPortraits', entries: 'settings.entries.bossPortraits' },
];

const THEME_TEXT: Record<ThemeName, { name: MessageKey; hint: MessageKey }> = {
  slate: { name: 'theme.slate', hint: 'theme.slateHint' },
  bark: { name: 'theme.bark', hint: 'theme.barkHint' },
};

/** The theme and the shipped game data. */
export function SettingsDialog() {
  const closeSettings = useApp((s) => s.closeSettings);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const gameData = useApp((s) => s.gameData);
  const loading = useApp((s) => s.gameDataLoading);
  const closeRef = useRef<HTMLButtonElement>(null);
  const hintId = useId();

  // Focus moves into the dialog and back to where it came from (the Settings button).
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);

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
          <h3 className="cap settings-label">{t('settings.gameData')}</h3>
          {gameData === null ? (
            <p className="settings-note">{loading ? t('settings.loading') : t('settings.statusUnavailable')}</p>
          ) : (
            <>
              <ul className="settings-tables">
                {TABLES.map((table) => (
                  <li key={table.key}>
                    <span>{t(table.name)}</span>
                    <span className="settings-status">{t(table.entries, { count: gameData[table.key] })}</span>
                  </li>
                ))}
              </ul>
              <p className="settings-note settings-source">{t('settings.source', { date: formatLocalDate(gameData.fetchedUnixMs) })}</p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
