import { describe, expect, it } from 'vitest';
import type { ConsumableEntry, QuickOverview } from '../../api/types';
import { overviewFixture } from '../../test/overviewFixture';
import { consumableColumns, consumableLegend } from './consumableModel';

const legendOf = (overview: QuickOverview) => consumableLegend(overview, consumableColumns(overview)).map((item) => item.name);

describe('consumable model', () => {
  it('names the item used most often per column, the first in log order on a tie', () => {
    const demonic: ConsumableEntry[] = [
      { player: 2, t: 100_000, spellId: 452930, kind: 'healthstone' },
      { player: 3, t: 110_000, spellId: 452930, kind: 'healthstone' },
    ];
    const spells = { ...overviewFixture.spells, '452930': { name: 'Demonic Healthstone' } };
    expect(legendOf(overviewFixture)).toEqual(['Potion of Recklessness', 'Healthstone', 'Concentrated Silvermoon Health Potion']);
    expect(legendOf({ ...overviewFixture, spells, consumables: [...overviewFixture.consumables, ...demonic] })).toContain('Demonic Healthstone');
    expect(legendOf({ ...overviewFixture, spells, consumables: [...overviewFixture.consumables, demonic[0]] })).toContain('Healthstone');
  });

  it('adds the mana potion column only when someone drank one', () => {
    expect(consumableColumns(overviewFixture).map((c) => c.kind)).toEqual(['combat_potion', 'healthstone', 'health_potion']);
    const mana: ConsumableEntry = { player: 2, t: 150_000, spellId: 1236648, kind: 'mana_potion' };
    expect(consumableColumns({ ...overviewFixture, consumables: [mana] }).map((c) => c.kind)).toEqual([
      'combat_potion',
      'healthstone',
      'health_potion',
      'mana_potion',
    ]);
  });
});
