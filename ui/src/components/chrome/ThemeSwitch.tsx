import type { ReactNode } from 'react';
import { type MessageKey, t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { THEME_MODES, type ThemeMode } from '../../theme';

const LABELS: Record<ThemeMode, MessageKey> = { system: 'theme.system', light: 'theme.light', dark: 'theme.dark' };

const ICONS: Record<ThemeMode, ReactNode> = {
  system: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  dark: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
};

/** System · Light · Dark as icon buttons in the top bars. */
export function ThemeSwitch() {
  const mode = useApp((s) => s.themeMode);
  const setMode = useApp((s) => s.setThemeMode);
  return (
    <div className="theme-switch" role="group" aria-label={t('theme.mode')}>
      {THEME_MODES.map((option) => (
        <button
          key={option}
          type="button"
          className={option === mode ? 'theme-switch-on' : undefined}
          aria-pressed={option === mode}
          aria-label={t(LABELS[option])}
          title={t(LABELS[option])}
          onClick={() => setMode(option)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            {ICONS[option]}
          </svg>
        </button>
      ))}
    </div>
  );
}
