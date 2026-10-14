import { describe, expect, it } from 'vitest';
import type { FightRow } from '../../api/types';
import { overviewFixture } from '../../test/overviewFixture';
import { aurasReportFixture, breakdownFixture, castsReportFixture, damageReportFixture, deathsReportFixture, interruptsReportFixture, resourcesReportFixture } from '../../test/reportFixtures';
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
  run: null,
  runIndex: null,
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
  breakdown: null,
  scope: { perspective: 'friendly', source: [], target: [], ability: [] },
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

  it('reads Ebon Might and the player count from the core and names targets when grouped by target', () => {
    const data = { ...aurasReportFixture, group: 'target' as const, ebonMight: { uptime: 0.5, holders: 3 }, players: 7 };
    const lines = text({ tab: 'buffs', report: { tab: 'buffs', data }, scope: { perspective: 'enemy', source: [], target: [], ability: [] } });
    expect(lines[1]).toBe('Ebon Might uptime|50.0%|on 3 players');
    expect(lines[2].split('|')[0]).toBe('Targets');
    expect(lines[3]).toBe('Players|7|who applied them');
  });

  it('waits for the tab report instead of showing stale figures', () => {
    const damage = { tab: 'damage' as const, data: damageReportFixture };
    expect(text({ tab: 'healing', report: damage }).map((line) => line.split('|')[1])).toEqual(['…', '…', '…', '…']);
    expect(text({ tab: 'damage', report: damage, reportLoading: true })[0]).toBe('Raid DPS|…|');
    // A failed reload keeps the previous range's report in the store.
    expect(text({ tab: 'damage', report: damage, reportFailed: true })[0]).toBe('Raid DPS|…|');
  });

  it('reads the casts tiles from the effective grouping of the core', () => {
    const casts = { tab: 'casts' as const, data: castsReportFixture };
    expect(text({ tab: 'casts', report: casts })).toEqual([
      'Casts|76|over 2:00 of combat',
      'Avg CPM|19.0|per casting player',
      'Top source|Faelan|40×',
      'Sources|2|',
    ]);
  });

  it('reads the interrupt tiles from the core and keeps missed casts to friendlies', () => {
    const interrupts = { tab: 'interrupts' as const, data: interruptsReportFixture };
    expect(text({ tab: 'interrupts', report: interrupts })).toEqual([
      'Interrupts|2|by 2 sources',
      'Dispels|1|by 1 source',
      'Missed interruptible casts|1|completed without an interrupt',
      'Most interrupted|2×|Venom Bolt',
    ]);
    const enemies = { perspective: 'enemy' as const, source: [], target: [], ability: [] };
    expect(text({ tab: 'interrupts', report: interrupts, scope: enemies })[2]).toBe('Missed interruptible casts|—|only for friendlies');
    const picked = { perspective: 'friendly' as const, source: [{ kind: 'player' as const, actorId: 4 }], target: [], ability: [] };
    expect(text({ tab: 'interrupts', report: interrupts, scope: picked })[2]).toBe('Missed interruptible casts|—|not for a selected source');
  });

  it('trades Survivors for the time dead once one player is selected', () => {
    const deaths = { tab: 'deaths' as const, data: deathsReportFixture };
    expect(text({ tab: 'deaths', report: deaths })[3]).toBe('Survivors|22|of 23 players');
    const faelan = { perspective: 'friendly' as const, source: [], target: [{ kind: 'player' as const, actorId: 4 }], ability: [] };
    expect(text({ tab: 'deaths', report: deaths, scope: faelan })[3]).toBe('Time dead|0:20|of 1 death');
  });

  it("shows one selected unit's primary resource on Resources", () => {
    const resources = { tab: 'resources' as const, data: { ...resourcesReportFixture, units: resourcesReportFixture.units.slice(0, 1) } };
    const faelan = { perspective: 'friendly' as const, source: [{ kind: 'player' as const, actorId: 4 }], target: [], ability: [] };
    expect(text({ tab: 'resources', report: resources, scope: faelan })).toEqual([
      'Average|82.5%|Mana',
      'Minimum|50.0%|Mana',
      'Time at cap|10.0 s|Mana',
      'Wasted|10.00k|Mana',
    ]);
  });

  it('keeps the pull figures without filters and follows the breakdown once filters are set', () => {
    const damage = { tab: 'damage' as const, data: damageReportFixture };
    expect(text({ tab: 'damage', report: damage, breakdown: breakdownFixture })[0]).toBe('Raid DPS|775.07k|370.96M damage');
    const scope = { perspective: 'friendly' as const, source: [], target: [{ kind: 'unit' as const, name: "Ula'tek" }], ability: [] };
    expect(text({ tab: 'damage', report: damage, breakdown: breakdownFixture, scope })).toEqual([
      'Damage Done|3.00M|',
      'DPS|300.00k|',
      'Top source|Wendel|2.00M',
      'Sources|2|',
    ]);
  });
});
