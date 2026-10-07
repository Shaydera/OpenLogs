import { describe, expect, it } from 'vitest';
import type { FightRow } from '../../api/types';
import { logFixture } from '../../test/logFixture';
import { fightMeta } from './fightMeta';

/** The items as text, mono ones in brackets. */
const read = (row: FightRow) => fightMeta(row).map((item) => (item.mono ? `[${item.text}]` : item.text));

describe('fight meta line', () => {
  it('lists the facts of a boss pull and the boss HP of a wipe', () => {
    expect(read(logFixture.fights[0])).toEqual(['Heroic', '[2:22]', '4 players', 'Oct 7, 2026 · 19:10', 'The Venomous Abyss', 'Boss HP at end 60.4%']);
  });
});
