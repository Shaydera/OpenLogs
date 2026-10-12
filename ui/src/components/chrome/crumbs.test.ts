import { describe, expect, it } from 'vitest';
import { compareLogFixture } from '../../test/compareFixture';
import { overviewFixture } from '../../test/overviewFixture';
import { abilityDetailFixture } from '../../test/reportFixtures';
import { runLogFixture } from '../../test/runFixture';
import { type Crumb, type CrumbInput, fightCrumbs } from './crumbs';

// Ula'tek Heroic: pull #1 a 2:22 wipe, pull #3 the 7:58 kill.
const [WIPE, , KILL] = compareLogFixture.fights;
const FILE = 'WoWCombatLog-100726_185823.txt';
const RUN_FILE = 'WoWCombatLog-100826_195800.txt';
const base: CrumbInput = {
  log: compareLogFixture,
  row: KILL,
  tab: 'overview',
  details: [],
  overview: overviewFixture,
  report: null,
  comparing: false,
};

/** Label and what a click does: `current` for the page shown, `text` for a plain level. */
const read = (crumbs: Crumb[]) => crumbs.map((crumb) => [crumb.label, crumb.current ? 'current' : (crumb.action?.kind ?? 'text')]);

describe('fight breadcrumb', () => {
  it('ends in the pull on the Overview, adds the result on report tabs and the tab on Casts', () => {
    expect(read(fightCrumbs(base))).toEqual([
      [FILE, 'pulls'],
      ["Ula'tek · Pull #3", 'current'],
    ]);
    expect(read(fightCrumbs({ ...base, row: WIPE, tab: 'damage' }))).toEqual([
      [FILE, 'pulls'],
      ["Ula'tek · Pull #1 · Wipe 2:22", 'current'],
    ]);
    expect(read(fightCrumbs({ ...base, tab: 'casts' }))).toEqual([
      [FILE, 'pulls'],
      ["Ula'tek · Pull #3", 'overview'],
      ['Casts', 'current'],
    ]);
  });

  it('lists the detail stack with links to the lower pages and enemies under a plain "Enemies" level', () => {
    const player = { kind: 'player' as const, player: 4 };
    const ability = { kind: 'ability' as const, player: 4, spellId: 44425, pet: null };
    const crumbs = fightCrumbs({ ...base, tab: 'damage', details: [player, ability], report: { tab: 'ability', data: abilityDetailFixture } });
    expect(read(crumbs)).toEqual([
      [FILE, 'pulls'],
      ["Ula'tek · Pull #3", 'overview'],
      ['Faelan', 'detail'],
      ['Arcane Barrage', 'current'],
    ]);
    expect(crumbs[2].action).toEqual({ kind: 'detail', depth: 0 });
    const target = { kind: 'target' as const, name: 'Blightscale Rawling' };
    expect(read(fightCrumbs({ ...base, tab: 'damage', details: [target, player] })).slice(2)).toEqual([
      ['Enemies', 'text'],
      ['Blightscale Rawling', 'detail'],
      ['Faelan', 'current'],
    ]);
  });

  it('heads a Mythic+ run with its key and numbers its boss pulls within the run', () => {
    const [run, , , braunpyke] = runLogFixture.fights;
    const runBase = { ...base, log: runLogFixture };
    expect(read(fightCrumbs({ ...runBase, row: run }))).toEqual([
      [RUN_FILE, 'pulls'],
      ['Priory of the Sacred Flame +12', 'current'],
    ]);
    expect(read(fightCrumbs({ ...runBase, row: run, tab: 'damage' }))[1]).toEqual(['Priory of the Sacred Flame +12 · Completed 31:00', 'current']);
    const crumbs = fightCrumbs({ ...runBase, row: braunpyke });
    expect(read(crumbs)).toEqual([
      [RUN_FILE, 'pulls'],
      ['Priory of the Sacred Flame +12', 'fight'],
      ['Baron Braunpyke · Pull #3', 'current'],
    ]);
    expect(crumbs[1].action).toEqual({ kind: 'fight', index: 1 });
  });
});
