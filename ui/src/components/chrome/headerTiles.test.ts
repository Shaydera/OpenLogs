import { describe, expect, it } from 'vitest';
import type { SetDeaths, SetPull } from '../../api/types';
import { compareLogFixture } from '../../test/compareFixture';
import { overviewFixture } from '../../test/overviewFixture';
import { aurasReportFixture, breakdownFixture, castsReportFixture, damageReportFixture, deathsReportFixture, interruptsReportFixture, resourcesReportFixture, takenReportFixture } from '../../test/reportFixtures';
import { setRows } from '../overview/setOverviewModel';
import { type HeaderInput, headerTiles } from './headerTiles';

const input = (partial: Partial<HeaderInput>): HeaderInput => ({
  tab: 'overview',
  playerCount: 23,
  setRows: null,
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

  it('set_tiles_average_the_first_death_over_pulls_with_a_death', () => {
    const [wipe, , kill] = compareLogFixture.fights;
    const fights = [
      { ...wipe, index: 1, durationMs: 120_000, bossHpPercent: 60.4 },
      { ...wipe, index: 2, durationMs: 80_000, bossHpPercent: 33.8 },
      { ...kill, index: 3, durationMs: 300_000, bossHpPercent: 0 },
    ];
    const pull = (fightIndex: number, deaths: number, firstDeathMs: number | null): SetPull => ({
      fightIndex,
      kpis: { ...overviewFixture.kpis, deaths, firstDeathMs },
      bossHpStepMs: 60_000,
      bossHp: [],
    });
    const rows = setRows(fights, [pull(1, 3, 40_000), pull(2, 1, 120_000), pull(3, 0, null)]);
    const kpis = { ...overviewFixture.kpis, durationMs: 500_000, raidDamage: 1_500_000_000, raidDps: 3_000_000, deaths: 4, firstDeathMs: 40_000 };
    expect(text({ setRows: rows, overview: { ...overviewFixture, kpis } })).toEqual([
      'Raid DPS|3.00M|1.500B over 8:20',
      'Best wipe|33.8%|pull #2',
      'Deaths|4|1.3 per pull',
      'First death|avg 1:20|earliest 0:40.0 (#1)',
    ]);
    const kills = setRows(fights, [pull(3, 0, null)]);
    expect(text({ setRows: kills, overview: { ...overviewFixture, kpis } }).slice(1)).toEqual(['Best kill|5:00|pull #3', 'Deaths|4|4.0 per pull', 'First death|—|nobody died']);
  });

  it('set_death_tiles_give_the_median_window', () => {
    const rows = setRows(compareLogFixture.fights, [1, 3].map((fightIndex) => ({ fightIndex, kpis: overviewFixture.kpis, bossHpStepMs: 60_000, bossHp: [] })));
    const recap = deathsReportFixture.deaths[0];
    const death = (windowMs: number) => ({ ...recap, t: 100_000, windowStartMs: 100_000 - windowMs });
    const pull = (fightIndex: number, windows: number[]) => ({ fightIndex, durationMs: 120_000, deaths: windows.map(death), kills: [], lifetime: [] });
    const data: SetDeaths = {
      ...deathsReportFixture,
      deaths: [],
      mostLethal: { spellId: 1302982, environmental: false, count: 3 },
      pulls: [pull(1, [2_000, 9_000]), pull(3, [5_000])],
      byKillingBlow: [{ spellId: 1302982, environmental: false, sources: ["Ula'tek"], count: 3 }],
      noLethal: 0,
      byPlayer: [],
    };
    expect(text({ tab: 'deaths', setRows: rows, report: { tab: 'deaths', data } }).slice(0, 3)).toEqual([
      'Deaths|3|1.5 per pull',
      "Most lethal ability|Virulent Spit|3 deaths · Ula'tek",
      'Median window|5.0 s|last full HP → death',
    ]);
  });

  it('set_first_death_tile_follows_the_selected_players', () => {
    const raidFirstDeath = { ...overviewFixture.kpis, firstDeathMs: 5_000 };
    const rows = setRows(compareLogFixture.fights, [1, 3].map((fightIndex) => ({ fightIndex, kpis: raidFirstDeath, bossHpStepMs: 60_000, bossHp: [] })));
    const pull = (fightIndex: number, firstDeathMs: number | null) => ({ fightIndex, durationMs: 120_000, deaths: [], kills: [], lifetime: [{ player: 4, firstDeathMs }] });
    const data: SetDeaths = { ...deathsReportFixture, deaths: [], pulls: [pull(1, 70_000), pull(3, 20_000)], byKillingBlow: [], noLethal: 0, byPlayer: [] };
    const faelan = { perspective: 'friendly' as const, source: [], target: [{ kind: 'player' as const, actorId: 4 }], ability: [] };
    expect(text({ tab: 'deaths', setRows: rows, scope: faelan, report: { tab: 'deaths', data } })[3]).toBe('First death|avg 0:45|earliest 0:20.0 (#3)');
  });

  it('set_damage_taken_counts_the_deaths_of_every_pull', () => {
    const rows = setRows(compareLogFixture.fights, [1, 3].map((fightIndex) => ({ fightIndex, kpis: overviewFixture.kpis, bossHpStepMs: 60_000, bossHp: [] })));
    const markers = { ...overviewFixture.timeline.markers, deaths: [] };
    const overview = { ...overviewFixture, kpis: { ...overviewFixture.kpis, deaths: 5 }, timeline: { ...overviewFixture.timeline, markers } };
    const report = { tab: 'taken' as const, data: takenReportFixture };
    expect(text({ tab: 'taken', setRows: rows, overview, report })[3]).toBe('Deaths|5|2.5 per pull');
  });
});
