import { describe, expect, it } from 'vitest';
import { logFixture } from '../../test/logFixture';
import { overviewFixture } from '../../test/overviewFixture';
import { abilityDetailFixture } from '../../test/reportFixtures';
import { type Crumb, type CrumbInput, fightCrumbs } from './crumbs';

// Ula'tek Heroic: pull #1 a 2:22 wipe, pull #3 the 7:58 kill.
const [WIPE, , KILL] = logFixture.fights;
const FILE = 'WoWCombatLog-100726_185823.txt';
const base: CrumbInput = {
  log: logFixture,
  row: KILL,
  tab: 'overview',
  details: [],
  overview: overviewFixture,
  report: null,
};

/** Label and what a click does: `current` for the page shown, `text` for a plain level. */
const read = (crumbs: Crumb[]) => crumbs.map((crumb) => [crumb.label, crumb.current ? 'current' : (crumb.action?.kind ?? 'text')]);

describe('fight breadcrumb', () => {
  it('ends in the pull on the Overview and adds the result on report tabs', () => {
    expect(read(fightCrumbs(base))).toEqual([
      [FILE, 'pulls'],
      ["Ula'tek · Pull #3", 'current'],
    ]);
    expect(read(fightCrumbs({ ...base, row: WIPE, tab: 'damage' }))).toEqual([
      [FILE, 'pulls'],
      ["Ula'tek · Pull #1 · Wipe 2:22", 'current'],
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
});
