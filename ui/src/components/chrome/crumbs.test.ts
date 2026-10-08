import { describe, expect, it } from 'vitest';
import { logFixture } from '../../test/logFixture';
import { type Crumb, type CrumbInput, fightCrumbs } from './crumbs';

// Ula'tek Heroic: pull #1 a 2:22 wipe, pull #3 the 7:58 kill.
const [WIPE, , KILL] = logFixture.fights;
const FILE = 'WoWCombatLog-100726_185823.txt';
const base: CrumbInput = {
  log: logFixture,
  row: KILL,
  tab: 'overview',
};

/** Label and what a click does: `current` for the page shown. */
const read = (crumbs: Crumb[]) => crumbs.map((crumb) => [crumb.label, crumb.current ? 'current' : crumb.action?.kind]);

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
});
