import { describe, expect, it } from 'vitest';
import { playerDetailFixture } from '../../test/reportFixtures';
import { deathSummary } from './deathSummary';

const death = playerDetailFixture.deaths[0];

describe('deathSummary', () => {
  it('names the burst or the single lethal hit without its overkill, then defensives and consumables', () => {
    expect(deathSummary(playerDetailFixture, death)).toBe(
      '2× Virulent Spit within 1.0 s. Ice Cold, Greater Invisibility and Alter Time on cooldown; healthstone and health potion unused.',
    );
    // 2.42M on a 1.12M-HP player, 1.38M of it overkill.
    const melee = { ...death.killingBlow!, spellId: 0, amount: 2_420_000, overkill: 1_380_000 };
    expect(deathSummary(playerDetailFixture, { ...death, killingBlow: melee, lethalBurst: { spellId: 0, count: 1, windowMs: 0 }, context: [] })).toBe(
      'Melee hit for 1.04M.',
    );
  });

  it('leaves out used items and the combat potion', () => {
    const context = [
      { item: 'defensive' as const, spellId: 235450, state: 'used' as const, t: 9_000 },
      { item: 'defensive' as const, spellId: 414658, state: 'on_cooldown' as const, t: 4_000 },
      { item: 'healthstone' as const, spellId: 6262, state: 'used' as const, t: 9_000 },
      { item: 'health_potion' as const, spellId: 1234768, state: 'available' as const, t: null },
      { item: 'combat_potion' as const, spellId: 1236616, state: 'on_cooldown' as const, t: 2_000 },
    ];
    expect(deathSummary(playerDetailFixture, { ...death, lethalBurst: null, context })).toBe('Ice Cold on cooldown; health potion unused.');
    const potionOnly = [{ item: 'combat_potion' as const, spellId: 1236994, state: 'available' as const, t: null }];
    expect(deathSummary(playerDetailFixture, { ...death, lethalBurst: null, context: potionOnly })).toBe('');
  });
});
