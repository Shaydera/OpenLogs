import type { ThemeName } from '../theme';

type Mode = 'light' | 'dark';

/** How strongly a `tokens.css` selector applies to the root of `theme`/`mode`; -1: not at all. */
function selectorWeight(selector: string, theme: ThemeName, mode: Mode): number {
  if (selector === ':root') return 1;
  const both = /^:root\[data-theme="(\w+)"\]\[data-mode="(\w+)"\]$/.exec(selector);
  if (both) return both[1] === theme && both[2] === mode ? 3 : -1;
  const modeOnly = /^:root\[data-mode="(\w+)"\]$/.exec(selector);
  if (modeOnly) return modeOnly[1] === mode ? 2 : -1;
  return -1;
}

/** Every custom property of `tokens.css` as the cascade resolves it on the root for a theme and mode. */
export function themeTokens(css: string, theme: ThemeName, mode: Mode): Record<string, string> {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [...plain.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((match, index) => ({
    index,
    weight: Math.max(...match[1].split(',').map((selector) => selectorWeight(selector.trim(), theme, mode))),
    body: match[2],
  }));
  const values: Record<string, string> = {};
  for (const block of blocks.filter((b) => b.weight >= 0).sort((a, b) => a.weight - b.weight || a.index - b.index)) {
    for (const declaration of block.body.split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      const name = declaration.slice(0, colon).trim();
      if (name.startsWith('--')) values[name.slice(2)] = declaration.slice(colon + 1).trim();
    }
  }
  return values;
}
