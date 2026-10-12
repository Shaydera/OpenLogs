import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import themeInit from '../public/theme-init.js?raw';
import { applyTheme, followSystemScheme, readTheme, readThemeMode, storeTheme, storeThemeMode } from './theme';

/** A controllable `prefers-color-scheme: dark` query. */
function mockScheme(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: dark,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', () => query);
  return {
    listeners,
    change(next: boolean) {
      query.matches = next;
      listeners.forEach((listener) => listener());
    },
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('theme', () => {
  it('keeps a stored choice, ignores unknown values, and marks the root before the first paint the same way', () => {
    expect([readTheme(), readThemeMode()]).toEqual(['slate', 'dark']);
    storeTheme('bark');
    storeThemeMode('system');
    expect([readTheme(), readThemeMode()]).toEqual(['bark', 'system']);

    const root = document.documentElement;
    for (const osDark of [true, false]) {
      mockScheme(osDark);
      for (const theme of [null, 'slate', 'bark', 'unknown']) {
        for (const mode of [null, 'light', 'dark', 'system', 'auto']) {
          localStorage.clear();
          if (theme) localStorage.setItem('openlogs.theme', theme);
          if (mode) localStorage.setItem('openlogs.themeMode', mode);
          new Function(themeInit)();
          const early = [root.dataset.theme, root.dataset.mode];
          applyTheme(readTheme(), readThemeMode());
          expect(early, `${theme} ${mode} ${osDark}`).toEqual([root.dataset.theme, root.dataset.mode]);
        }
      }
    }
  });

  it('marks the root with the resolved mode, following the OS while System is chosen', () => {
    const scheme = mockScheme(false);
    const root = document.createElement('div');
    applyTheme('slate', 'system', root);
    expect([root.dataset.theme, root.dataset.mode]).toEqual(['slate', 'light']);
    const stop = followSystemScheme(() => applyTheme('slate', 'system', root));
    scheme.change(true);
    expect(root.dataset.mode).toBe('dark');
    stop();
    expect(scheme.listeners.size).toBe(0);
    applyTheme('bark', 'light', root);
    expect([root.dataset.theme, root.dataset.mode]).toEqual(['bark', 'light']);
  });
});
