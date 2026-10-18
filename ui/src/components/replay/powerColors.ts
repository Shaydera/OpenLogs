export const POWER_TOKENS: Record<number, string> = {
  0: 'mana',
  1: 'rage',
  2: 'focus',
  3: 'energy',
  6: 'runic',
  8: 'astral',
  11: 'maelstrom',
  13: 'insanity',
  17: 'fury',
  18: 'pain',
  19: 'essence',
};

const powerToken = (powerType: number) => POWER_TOKENS[powerType] ?? 'other';

export function powerColorVar(powerType: number): string {
  return `var(--power-${powerToken(powerType)})`;
}

/** The text colour on a power fill: its own `--power-*-text` where the shared on-fill colour is too weak. */
export function powerTextVar(powerType: number): string {
  return `var(--power-${powerToken(powerType)}-text, var(--bar-text-on-fill))`;
}
