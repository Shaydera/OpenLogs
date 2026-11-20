import { afterEach, describe, expect, it } from 'vitest';
import { setCurrentLog } from '../../currentGame';
import { shortName } from './players';

describe('player names', () => {
  afterEach(() => setCurrentLog(null));

  it('shows a Forever name in full and a retail name by its first part', () => {
    setCurrentLog({ game: { kind: 'forever' }, dataGame: 'forever' });
    expect([shortName('Ravel-Ashwood-Normal-EU'), shortName('Wolf')]).toEqual(['Ravel Ashwood', 'Wolf']);
    setCurrentLog({ game: { kind: 'retail' }, dataGame: 'retail' });
    expect(shortName('Faelan-Emberfall-EU')).toBe('Faelan');
  });
});
