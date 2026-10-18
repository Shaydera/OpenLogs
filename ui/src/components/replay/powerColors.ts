const POWER_TOKENS: Record<number, string> = {
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

export function powerColorVar(powerType: number): string {
  return `var(--power-${POWER_TOKENS[powerType] ?? 'other'})`;
}
