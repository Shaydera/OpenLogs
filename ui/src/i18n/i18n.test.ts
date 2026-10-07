import { describe, expect, it } from 'vitest';
import { t } from './i18n';

describe('t', () => {
  it('interpolates parameters and leaves unknown placeholders visible', () => {
    expect(t('start.indexing', { file: 'WoWCombatLog-100726_185823.txt' })).toBe('Indexing WoWCombatLog-100726_185823.txt…');
    expect(t('start.indexing')).toBe('Indexing {file}…');
  });

  it('chooses the plural form from count', () => {
    expect(t('pulls.count', { count: 1 })).toBe('1 pull');
    expect(t('pulls.count', { count: 3 })).toBe('3 pulls');
  });

  it('groups numeric counts but leaves other numbers raw', () => {
    expect(t('fight.players', { count: 1_234 })).toBe('1,234 players');
    expect(t('overview.unknownSpell', { id: 1300001 })).toBe('Spell 1300001');
  });
});
