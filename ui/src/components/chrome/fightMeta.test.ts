import { describe, expect, it } from 'vitest';
import type { FightRow } from '../../api/types';
import { compareLogFixture } from '../../test/compareFixture';
import { runLogFixture } from '../../test/runFixture';
import { type MetaItem, fightMeta, setIdentity, setMeta } from './fightMeta';

/** The items as text, mono ones in brackets. */
const text = (items: MetaItem[]) => items.map((item) => [item.mono ? `[${item.text}]` : item.text, item.suffix].filter(Boolean).join(' '));
const read = (row: FightRow) => text(fightMeta(row));

describe('fight meta line', () => {
  it('lists the facts of a boss pull and the boss HP of a wipe', () => {
    expect(read(compareLogFixture.fights[0])).toEqual(['Heroic', '[2:22]', '4 players', 'Oct 7, 2026 · 19:10', 'The Venomous Abyss', 'Boss HP at end 60.4%']);
  });

  it('claims nothing a run did not log or the dungeon data does not know', () => {
    const run = runLogFixture.fights[0];
    const bare: FightRow = { ...run, outcome: 'incomplete', run: { ...run.run!, totalTimeMs: null, affixIds: [], bosses: null, timer: null } };
    expect(read(bare)).toEqual(['[31:00]', '5 players', 'Oct 8, 2026 · 20:01']);
  });

  it('set_meta_counts_wipes_and_kills_and_sums_the_duration', () => {
    const set = { kind: 'all' as const, encounterId: 3492, difficulty: 15, fights: [1, 3] };
    const identity = setIdentity(compareLogFixture, set);
    expect(identity).toMatchObject({ name: "Ula'tek", wipes: 1, kills: 1, durationMs: 142_550 + 478_610 });
    expect(text(setMeta(identity, 4))).toEqual(['Heroic', '1 wipe, 1 kill', '[10:21] summed', '4 players', '19:10 – 19:37']);
  });
});
