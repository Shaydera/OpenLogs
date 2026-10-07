import { describe, expect, it } from 'vitest';
import { damageReportFixture, takenReportFixture } from '../../test/reportFixtures';
import { timelineFixture } from '../../test/timelineFixture';
import { type HeaderInput, headerTiles } from './headerTiles';

const input = (partial: Partial<HeaderInput>): HeaderInput => ({
  tab: 'damage',
  timeline: timelineFixture,
  range: null,
  report: null,
  reportLoading: false,
  reportFailed: false,
  ...partial,
});

const text = (partial: Partial<HeaderInput>) => headerTiles(input(partial)).map((tile) => `${tile.label}|${tile.value}|${tile.sub}`);

describe('headerTiles', () => {
  it('counts the deaths of the whole pull, or of the range, on Damage Taken', () => {
    const taken = { tab: 'taken' as const, data: takenReportFixture };
    expect(text({ tab: 'taken', report: taken })[3]).toBe('Deaths|2|first at 0:33');
    expect(text({ tab: 'taken', report: taken, range: { startMs: 40_000, endMs: 300_000 } })[3]).toBe('Deaths|1|first at 3:59');
    expect(text({ tab: 'taken', report: taken, timeline: null })[3]).toBe('Deaths|…|');
  });

  it('waits for the tab report instead of showing stale figures', () => {
    const damage = { tab: 'damage' as const, data: damageReportFixture };
    expect(text({ tab: 'healing', report: damage }).map((line) => line.split('|')[1])).toEqual(['…', '…', '…', '…']);
    expect(text({ tab: 'damage', report: damage, reportLoading: true })[0]).toBe('Raid DPS|…|');
    // A failed reload keeps the previous range's report in the store.
    expect(text({ tab: 'damage', report: damage, reportFailed: true })[0]).toBe('Raid DPS|…|');
  });
});
