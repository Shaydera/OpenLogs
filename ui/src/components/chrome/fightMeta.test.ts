import { describe, expect, it } from 'vitest';
import type { FightRow } from '../../api/types';
import { compareLogFixture } from '../../test/compareFixture';
import { runLogFixture } from '../../test/runFixture';
import { fightMeta } from './fightMeta';

/** The items as text, mono ones in brackets. */
const read = (row: FightRow) => fightMeta(row).map((item) => (item.mono ? `[${item.text}]` : item.text));

describe('fight meta line', () => {
  it('lists the facts of a boss pull and the boss HP of a wipe', () => {
    expect(read(compareLogFixture.fights[0])).toEqual(['Heroic', '[2:22]', '4 players', 'Oct 7, 2026 · 19:10', 'The Venomous Abyss', 'Boss HP at end 60.4%']);
  });

  it('claims nothing a run did not log or the dungeon data does not know', () => {
    const run = runLogFixture.fights[0];
    const bare: FightRow = { ...run, outcome: 'incomplete', run: { ...run.run!, totalTimeMs: null, affixIds: [], bosses: null, timer: null } };
    expect(read(bare)).toEqual(['[31:00]', '5 players', 'Oct 8, 2026 · 20:01']);
  });
});
