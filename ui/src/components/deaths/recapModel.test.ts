import { describe, expect, it } from 'vitest';
import type { DeathRecap, RecapEvent } from '../../api/types';
import { recapFixture } from '../../test/reportFixtures';
import { contextRows, eventSource, recapCallout, recapPlot, recapRows } from './recapModel';

const faelan = recapFixture.deaths[0];
const name = (id: number) => recapFixture.spells[String(id)]?.name ?? '?';
const event = (over: Partial<RecapEvent>): RecapEvent => ({
  t: 238_000,
  spellId: 1302982,
  sourceName: "Ula'tek",
  kind: 'damage',
  amount: 1_000,
  absorbed: 0,
  excess: 0,
  hpPct: 50,
  environmental: false,
  periodic: false,
  sourceOwnerName: null,
  ...over,
});

describe('recapPlot', () => {
  it('draws the HP line and area from 8 s before to 0.4 s after the death', () => {
    const plot = recapPlot(faelan);
    expect([plot.startMs, plot.endMs]).toEqual([231_100, 239_500]);
    expect(plot.line).toBe('M 0 19.3 L 639.3 69.2 L 820.2 58.1 L 832.1 128.4 L 952.4 195');
    expect(plot.area).toBe(`${plot.line} L 952.4 200 L 0 200 Z`);
  });

  it('holds the first snapshot back to the window start', () => {
    const plot = recapPlot({ ...faelan, hp: faelan.hp.slice(1) });
    expect(plot.line).toBe('M 0 69.2 L 639.3 69.2 L 820.2 58.1 L 832.1 128.4 L 952.4 195');
  });
});

describe('recapCallout', () => {
  it('tells the burst, the HP drop, the cooldowns and the unused consumables', () => {
    expect(recapCallout(faelan, name)).toEqual({
      lead: '2× Virulent Spit within 1.0 s',
      body: ' – 355k each (≈ 37% of max HP). The first hit dropped HP from 74% to 36%, the second was lethal. Ice Cold and Greater Invisibility were on cooldown; ',
      warning: 'Healthstone and health potion were not used.',
    });
  });

  it('says when the log has no lethal hit, and has nothing to say without context', () => {
    expect(recapCallout({ ...faelan, killingBlow: null, lethalBurst: null }, name)).toEqual({
      lead: 'Lethal hit not in the log',
      body: '. Ice Cold and Greater Invisibility were on cooldown; ',
      warning: 'Healthstone and health potion were not used.',
    });
    expect(recapCallout({ ...faelan, killingBlow: null, lethalBurst: null, context: [] }, name)).toBeNull();
  });
});

describe('eventSource', () => {
  it('names the owner of a totem or pet and drops the realm of players', () => {
    expect(eventSource(event({ sourceName: 'Stormstream Totem', sourceOwnerName: 'Mulgar-Emberfall-EU' }))).toBe('Mulgar (Totem)');
    expect(eventSource(event({ sourceName: 'Fel Imp', sourceOwnerName: 'Årvel-Emberfall-EU' }))).toBe('Årvel (Pet)');
    expect(eventSource(event({ sourceName: 'Tyrell-Highmarch-EU' }))).toBe('Tyrell');
  });
});

describe('recapRows', () => {
  it('lists the last 3 s newest first with full amounts, HP and highlights', () => {
    const rows = recapRows(faelan, name).map(({ time, name: n, source, amount, hp, tone }) => [time, n, source, amount, hp, tone]);
    expect(rows).toEqual([
      ['−0.00 s', 'Virulent Spit', "Ula'tek", '−355,265 (4,923 overkill)', '0%', 'kill'],
      ['−0.83 s', 'Rune of Self-Mending', 'Faelan', '+12,552', '', null],
      ['−1.01 s', 'Virulent Spit', "Ula'tek", '−355,265', '36%', 'big'],
      ['−1.11 s', 'Necrotic Vapors', "Ula'tek", '−35,444', '74%', null],
      ['−2.37 s', 'Stormstream Totem', 'Mulgar (Totem)', '+14,195', '', null],
      ['−2.63 s', 'Deadly Venom', 'Debuff', '−45,999', '68%', null],
    ]);
  });

  it('measures the times from the killing blow, not from UNIT_DIED 10 ms later', () => {
    const rows = recapRows({ ...faelan, t: 239_110 }, name);
    expect(rows.slice(0, 3).map((r) => r.time)).toEqual(['−0.00 s', '−0.83 s', '−1.01 s']);
  });

  it('calls hits of 10 % of max HP big, or 100,000 without max HP', () => {
    const events = faelan.events.map((e) => (e.t === 237_990 ? { ...e, amount: 98_000 } : e));
    expect(recapRows({ ...faelan, events }, name).map((r) => r.tone)).toEqual(['kill', null, 'big', 'big', null, null]);
    expect(recapRows({ ...faelan, events, maxHp: null }, name).map((r) => r.tone)).toEqual(['kill', null, 'big', null, null, null]);
  });
});

describe('contextRows', () => {
  it('counts a consumable on cooldown as used, and marks a defensive never used', () => {
    const context: DeathRecap['context'] = [
      { item: 'combat_potion', spellId: 1236616, state: 'on_cooldown', t: 142_292 },
      { item: 'healthstone', spellId: 6262, state: 'used', t: 236_000 },
      { item: 'defensive', spellId: 414658, state: 'never_used', t: null },
    ];
    const { defensives, consumables } = contextRows({ ...faelan, context }, name);
    expect(defensives.map((r) => [r.name, r.state, r.tone])).toEqual([['Ice Cold', 'never used', 'st-un']]);
    expect(consumables.map((r) => [r.name, r.when, r.state, r.tone])).toEqual([
      ['Healthstone', '3:56 · −3 s', 'used', 'st-us'],
      ["Light's Potential", '2:22 · −1:36', 'used', 'st-us'],
    ]);
  });
});
