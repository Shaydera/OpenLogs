import { readStored, writeStored } from './storage';

export type ThemeName = 'slate' | 'bark';
/** What the user picked; `system` follows the OS colour scheme. */
export type ThemeMode = 'system' | 'light' | 'dark';
type ResolvedMode = 'light' | 'dark';

export const THEMES: readonly ThemeName[] = ['slate', 'bark'];
export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];
const DEFAULT_THEME: ThemeName = 'slate';
const DEFAULT_THEME_MODE: ThemeMode = 'dark';

const THEME_KEY = 'theme';
const MODE_KEY = 'themeMode';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function readChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const value = readStored(key);
  return allowed.find((option) => option === value) ?? fallback;
}

export const readTheme = (): ThemeName => readChoice(THEME_KEY, THEMES, DEFAULT_THEME);
export const readThemeMode = (): ThemeMode => readChoice(MODE_KEY, THEME_MODES, DEFAULT_THEME_MODE);
export const storeTheme = (theme: ThemeName) => writeStored(THEME_KEY, theme);
export const storeThemeMode = (mode: ThemeMode) => writeStored(MODE_KEY, mode);

function systemQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
}

function resolveMode(mode: ThemeMode, systemDark: boolean): ResolvedMode {
  if (mode === 'system') return systemDark ? 'dark' : 'light';
  return mode;
}

/** Sets `data-theme` and the resolved `data-mode` on the document root, which select the token sets. */
export function applyTheme(theme: ThemeName, mode: ThemeMode, root: HTMLElement = document.documentElement) {
  root.dataset.theme = theme;
  root.dataset.mode = resolveMode(mode, systemQuery()?.matches ?? true);
}

/** Calls `onChange` whenever the OS switches between light and dark; returns the unsubscribe. */
export function followSystemScheme(onChange: () => void): () => void {
  const query = systemQuery();
  if (!query) return () => {};
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
