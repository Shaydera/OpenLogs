import { describe, expect, it } from 'vitest';
import type { FightRow } from '../../api/types';
import { overviewFixture } from '../../test/overviewFixture';
import { aurasReportFixture, damageReportFixture } from '../../test/reportFixtures';
import { type HeaderInput, headerTiles } from './headerTiles';

const ROW: FightRow = {
  index: 1,
  encounterId: 3492,
  name: "Ula'tek",
  difficulty: 15,
  difficultyLabel: 'Heroic',
  outcome: 'kill',
  durationMs: 478_610,
  bossHpPercent: 0,
  playerCount: 23,
  startUnixMs: 0,
  zone: null,
};

const input = (partial: Partial<HeaderInput>): HeaderInput => ({
  tab: 'overview',
  row: ROW,
  overview: overviewFixture,
  range: null,
  report: null,
  reportLoading: false,
  reportFailed: false,
  rangeKpis: null,
  hideProcs: true,
  auraScope: 'buffs_on_players',
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

  it('counts prepull Bloodlust in a range from 0:00, as the Overview does', () => {
    const overview = { ...overviewFixture, timeline: { ...overviewFixture.timeline, markers: { ...overviewFixture.timeline.markers, bloodlust: [{ t: -1_500, player: 4, spellId: 80353 }] } } };
    const report = { tab: 'buffs' as const, data: aurasReportFixture };
    expect(text({ tab: 'buffs', overview, range: { startMs: 0, endMs: 60_000 }, report })[0]).toBe('Bloodlust|-0:01|Time Warp');
    expect(text({ tab: 'buffs', overview, range: { startMs: 5_000, endMs: 60_000 }, report })[0]).toBe('Bloodlust|—|not cast');
  });

  it('waits for the tab report instead of showing stale figures', () => {
    const damage = { tab: 'damage' as const, data: damageReportFixture };
    expect(text({ tab: 'healing', report: damage }).map((line) => line.split('|')[1])).toEqual(['…', '…', '…', '…']);
    expect(text({ tab: 'damage', report: damage, reportLoading: true })[0]).toBe('Raid DPS|…|');
    // A failed reload keeps the previous range's report in the store.
    expect(text({ tab: 'damage', report: damage, reportFailed: true })[0]).toBe('Raid DPS|…|');
  });
});
