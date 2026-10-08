import { describe, expect, it } from 'vitest';
import { overviewFixture } from '../../test/overviewFixture';
import { damageReportFixture } from '../../test/reportFixtures';
import { type HeaderInput, headerTiles } from './headerTiles';

const input = (partial: Partial<HeaderInput>): HeaderInput => ({
  tab: 'overview',
  overview: overviewFixture,
  range: null,
  report: null,
  reportLoading: false,
  reportFailed: false,
  ...partial,
});

const text = (partial: Partial<HeaderInput>) => headerTiles(input(partial)).map((tile) => `${tile.label}|${tile.value}|${tile.sub}`);

describe('headerTiles', () => {
  it('keeps the Overview figures of the whole pull, and of the range once it is calculated', () => {
    expect(text({})).toEqual([
      'Raid DPS|3.96M|1.894B damage',
      'Deaths|2|first at 0:33',
      'Combat potions|13|15 players used none',
      'Healthstone · Health potion|3 · 5|over 7:58 of combat',
    ]);
    const range = { startMs: 40_000, endMs: 60_000 };
    expect(text({ range }).map((line) => line.split('|')[1])).toEqual(['…', '…', '…', '…']);
    expect(text({ range, report: { tab: 'overview', data: overviewFixture } })[2]).toBe('Combat potions|13|15 used none in this range');
  });

  it('waits for the tab report instead of showing stale figures', () => {
    const damage = { tab: 'damage' as const, data: damageReportFixture };
    expect(text({ tab: 'healing', report: damage }).map((line) => line.split('|')[1])).toEqual(['…', '…', '…', '…']);
    expect(text({ tab: 'damage', report: damage, reportLoading: true })[0]).toBe('Raid DPS|…|');
    // A failed reload keeps the previous range's report in the store.
    expect(text({ tab: 'damage', report: damage, reportFailed: true })[0]).toBe('Raid DPS|…|');
  });
});
