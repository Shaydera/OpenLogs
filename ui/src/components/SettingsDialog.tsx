import { type CSSProperties, type KeyboardEvent, useEffect, useId, useRef } from 'react';
import type { GameDataManifest } from '../gameData';
import { formatLocalDate } from '../i18n/format';
import { type MessageKey, t } from '../i18n/i18n';
import { useApp } from '../store';
import { THEMES, type ThemeName } from '../theme';
import { effectiveScale, UI_SIZES } from '../uiScale';
import { useAutoScale } from '../hooks/useAutoScale';

const TABLES: { key: keyof Omit<GameDataManifest, 'fetchedUnixMs'>; name: MessageKey; entries: MessageKey }[] = [
  { key: 'spellIcons', name: 'settings.spellIcons', entries: 'settings.entries.spellIcons' },
  { key: 'channelSpells', name: 'settings.channelSpells', entries: 'settings.entries.spellIcons' },
  { key: 'dungeons', name: 'settings.dungeons', entries: 'settings.entries.dungeons' },
  { key: 'bossPortraits', name: 'settings.bossPortraits', entries: 'settings.entries.bossPortraits' },
  { key: 'mapArt', name: 'settings.mapArt', entries: 'settings.entries.mapArt' },
];

const THEME_TEXT: Record<ThemeName, { name: MessageKey; hint: MessageKey }> = {
  slate: { name: 'theme.slate', hint: 'theme.slateHint' },
  bark: { name: 'theme.bark', hint: 'theme.barkHint' },
};

/** The theme, the UI size and the shipped game data. */
export function SettingsDialog() {
  const closeSettings = useApp((s) => s.closeSettings);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const gameData = useApp((s) => s.gameData);
  const loading = useApp((s) => s.gameDataLoading);
  const uiSize = useApp((s) => s.uiSize);
  const setUiSize = useApp((s) => s.setUiSize);
  const auto = useAutoScale();
  const closeRef = useRef<HTMLButtonElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const sliderId = useId();
  const hintId = useId();

  // Focus moves into the dialog and back to where it came from (the Settings button).
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);

  // Native and non-passive: React's onWheel cannot stop the dialog from scrolling under the slider.
  useEffect(() => {
    const slider = sliderRef.current;
    if (!slider) return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      const current = useApp.getState().uiSize;
      const next = Math.min(UI_SIZES[UI_SIZES.length - 1], Math.max(UI_SIZES[0], current + direction * 5));
      if (next !== current) useApp.getState().setUiSize(next);
    };
    slider.addEventListener('wheel', onWheel, { passive: false });
    return () => slider.removeEventListener('wheel', onWheel);
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
      <section
        className="panel settings ui-scaled"
        // Zoomed by the automatic factor only: the user's size would move the slider away from the pointer while dragging.
        style={{ '--ui-scale': auto } as CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onKeyDown={onKeyDown}
      >
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
          <h3 className="cap settings-label">{t('uiSize.title')}</h3>
          <p className="settings-note">
            {t('uiSize.readout', { auto: Math.round(auto * 100), now: Math.round(effectiveScale(auto, uiSize) * 100) })}
          </p>
          <div className="ui-size">
            <label htmlFor={sliderId} className="ui-size-label">
              {t('uiSize.adjust')}
            </label>
            <input
              ref={sliderRef}
              id={sliderId}
              type="range"
              min={UI_SIZES[0]}
              max={UI_SIZES[UI_SIZES.length - 1]}
              step={5}
              value={uiSize}
              aria-valuetext={`${uiSize}%`}
              onChange={(event) => setUiSize(Number(event.target.value))}
            />
            <span className="ui-size-value">{uiSize}%</span>
            <button type="button" className="btn" disabled={uiSize === 100} onClick={() => setUiSize(100)}>
              {t('uiSize.reset')}
            </button>
          </div>
          <h3 className="cap settings-label">{t('settings.gameData')}</h3>
          {gameData === null ? (
            <p className="settings-note">{loading ? t('settings.loading') : t('settings.statusUnavailable')}</p>
          ) : (
            <>
              <ul className="settings-tables">
                {TABLES.map((table) => {
                  const count = gameData[table.key];
                  return (
                    count !== undefined && (
                      <li key={table.key}>
                        <span>{t(table.name)}</span>
                        <span className="settings-status">{t(table.entries, { count })}</span>
                      </li>
                    )
                  );
                })}
              </ul>
              <p className="settings-note settings-source">{t('settings.source', { date: formatLocalDate(gameData.fetchedUnixMs) })}</p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
