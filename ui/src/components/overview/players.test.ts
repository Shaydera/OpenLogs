import { afterEach, describe, expect, it } from 'vitest';
import { setCurrentGame } from '../../currentGame';
import { shortName } from './players';

describe('player names', () => {
  afterEach(() => setCurrentGame(null));

  it('shows a Forever name in full and a retail name by its first part', () => {
    setCurrentGame({ kind: 'forever' });
    expect([shortName('Ravel-Ashwood-Normal-EU'), shortName('Wolf')]).toEqual(['Ravel Ashwood', 'Wolf']);
    setCurrentGame({ kind: 'retail' });
    expect(shortName('Faelan-Emberfall-EU')).toBe('Faelan');
  });
});
