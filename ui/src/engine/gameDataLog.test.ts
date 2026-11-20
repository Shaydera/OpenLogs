import { describe, expect, it } from 'vitest';
import { GameDataLog } from './gameDataLog';

describe('GameDataLog', () => {
  it('gives a fresh session the latest table of each game', () => {
    const log = new GameDataLog();
    log.record('set_dungeons', ['keys']);
    log.record('set_spell_classes', ['retail classes', 'retail']);
    log.record('set_spell_classes', ['forever classes', 'forever']);
    log.record('set_spell_classes', ['newer retail classes', 'retail']);
    log.record('call', ['damage_done_report', '{}']);

    const given: unknown[][] = [];
    const session = {
      set_dungeons: (...args: unknown[]) => given.push(['set_dungeons', ...args]),
      set_spell_classes: (...args: unknown[]) => given.push(['set_spell_classes', ...args]),
    };
    log.replay(session);

    expect(given).toEqual([
      ['set_dungeons', 'keys'],
      ['set_spell_classes', 'newer retail classes', 'retail'],
      ['set_spell_classes', 'forever classes', 'forever'],
    ]);
  });
});
