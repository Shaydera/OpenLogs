import { describe, expect, it } from 'vitest';
import { valueLabel } from './labels';

describe('valueLabel', () => {
  it('names melee, unmatched support, the environment and numbered or unnamed units', () => {
    expect(valueLabel({ kind: 'id', spellId: 0 }, '')).toBe('Melee');
    expect(valueLabel({ kind: 'id', spellId: 0 }, '', null, 'unmatched')).toBe('Unmatched hits');
    expect(valueLabel({ kind: 'environment' }, '')).toBe('Environment');
    expect(valueLabel({ kind: 'instance', actorId: 9 }, 'Blightscale Rawling', 7)).toBe('Blightscale Rawling #7');
    expect(valueLabel({ kind: 'instance', actorId: 9 }, '', 2)).toBe('Unknown #2');
  });
});
