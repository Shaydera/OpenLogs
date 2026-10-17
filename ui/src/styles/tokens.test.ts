import { describe, expect, it } from 'vitest';
import tokensCss from './tokens.css?raw';
import { themeTokens } from '../test/themeTokens';

/** WCAG 2 relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = 4.5;
const NON_TEXT = 3;

const FIXED_PAIRS: [foreground: string, background: string, minimum: number][] = [
  ['text', 'bg', 7],
  ...['faint', 'muted', 'text-soft', 'accent'].flatMap((text) =>
    ['panel', 'panel-raised'].map((panel): [string, string, number] => [text, panel, TEXT]),
  ),
  ['neutral-text', 'neutral-tint', TEXT],
  ['on-accent', 'accent', TEXT],
  ['accent', 'accent-tint', TEXT],
  ['kill-chip', 'kill-tint', TEXT],
  ['support-text', 'support-tint', TEXT],
  ['muted', 'tag-bg', TEXT],
  ['muted', 'bar-track', TEXT],
  ['text', 'bar-track', TEXT],
  ['kill-text', 'kill-tint', TEXT],
  ['wipe-text', 'wipe-tint', TEXT],
  ['death', 'death-tint', TEXT],
  ...['dash', 'kill', 'wipe', 'pull-a', 'pull-b', 'lust', 'lust-line', 'mana', 'target-1', 'target-2', 'target-3', 'target-4', 'target-other', 'role-tank', 'role-healer', 'role-dps', 'tick'].map(
    (mark): [string, string, number] => [mark, 'panel', NON_TEXT],
  ),
  ...['hp-fill', 'hp-boss', 'hp-add', 'cast-fill'].map((bar): [string, string, number] => [bar, 'bar-track', NON_TEXT]),
  ...['square', 'triangle', 'diamond', 'cross', 'star', 'circle', 'moon', 'skull'].map((symbol): [string, string, number] => [`marker-${symbol}`, 'plot', NON_TEXT]),
  ...['heal', 'raid-cd', 'raid-buff', 'boss', 'missing'].map((category): [string, string, number] => [`effect-${category}`, 'plot', TEXT]),
  ['effect-missing', 'panel-raised', TEXT],
];

const combinations = (['slate', 'bark'] as const).flatMap((theme) => (['dark', 'light'] as const).map((mode) => [theme, mode] as const));

describe('theme colours', () => {
  it.each(combinations)('meet WCAG contrast minimums in %s, %s', (theme, mode) => {
    const tokens = themeTokens(tokensCss, theme, mode);
    const classPairs = Object.keys(tokens)
      .filter((name) => name.startsWith('class-'))
      .flatMap((name) => ['panel', 'panel-raised', 'tile', 'bar-track'].map((background): [string, string, number] => [name, background, TEXT]));
    expect(classPairs).toHaveLength(13 * 4);

    const failures = [...FIXED_PAIRS, ...classPairs]
      .map(([foreground, background, minimum]) => ({ pair: `${foreground} on ${background}`, ratio: contrast(tokens[foreground], tokens[background]), minimum }))
      .filter(({ ratio, minimum }) => !(ratio >= minimum));
    expect(failures).toEqual([]);
  });
});
