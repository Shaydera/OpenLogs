import { describe, expect, it } from 'vitest';
import type { ContextEntry, DeathEntry, QuickOverview } from '../../api/types';
import { overviewFixture } from '../../test/overviewFixture';
import { contextBadges, damageParts } from './deathModel';

const [wendel, faelan] = overviewFixture.deaths;
const overview: QuickOverview = {
  ...overviewFixture,
  spells: { ...overviewFixture.spells, '115203': { name: 'Fortifying Brew' } },
};
const at = (t: number, context: ContextEntry[]): DeathEntry => ({ ...wendel, t, context });
const summary = (death: DeathEntry) => contextBadges(overview, death).map(({ name, state, tone }) => [name, state, tone]);

describe('contextBadges', () => {
  it('lists defensives first, then healthstone, health potion and combat potion, each with its state', () => {
    expect(summary(faelan)).toEqual([
      ['Ice Cold', 'on CD · −35 s', 'b-cd'],
      ['Greater Invisibility', '3:51', 'b-used'],
      ['Healthstone', 'unused', 'b-unused'],
      ['Health potion', 'unused', 'b-unused'],
      ['Combat potion', 'pre-pull', 'b-used'],
    ]);
  });

  it('shows a potion on cooldown as used at its time and a long cooldown in minutes', () => {
    const sabrel = at(419_100, [
      { item: 'healthstone', spellId: 6262, state: 'available', t: null },
      { item: 'health_potion', spellId: 1295247, state: 'on_cooldown', t: 408_400 },
      { item: 'defensive', spellId: 115203, state: 'on_cooldown', t: 328_100 },
    ]);
    expect(summary(sabrel)).toEqual([
      ['Fortifying Brew', 'on CD · −1:31', 'b-cd'],
      ['Healthstone', 'unused', 'b-unused'],
      ['Health potion', '6:48', 'b-used'],
    ]);
  });
});

describe('damageParts', () => {
  it('keeps the four largest parts as shares of the damage taken and never divides by zero', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ spellId: 1297338 + i, amount: 100_000 - i * 10_000, environmental: false }));
    const parts = damageParts(overview, { ...wendel, damageLast5s: many, damageTaken5s: 450_000 });
    expect(parts.map((part) => part.tone)).toEqual([1, 2, 3, 4]);
    expect(parts[0].widthPct).toBeCloseTo(22.22, 1);
    const nothing = damageParts(overview, { ...wendel, damageLast5s: [{ spellId: 0, amount: 0, environmental: false }], damageTaken5s: 0 });
    expect(nothing[0].widthPct).toBe(0);
  });
});
