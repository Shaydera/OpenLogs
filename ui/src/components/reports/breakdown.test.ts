import { describe, expect, it } from 'vitest';
import type { AbilityRow, PlayerRef, TakenAbility } from '../../api/types';
import { namedIcon } from '../../icons';
import { abilityBreakdown, takenBreakdown } from './breakdown';

const roster = new Map<number, PlayerRef>([
  [4, { actorId: 4, name: 'Faelan-Emberfall-EU', specId: 62, specName: 'Arcane Mage', classId: 8, classToken: 'MAGE', role: 'damage' }],
  [5, { actorId: 5, name: 'Speronis-Stonevale-EU', specId: 1473, specName: 'Augmentation Evoker', classId: 13, classToken: 'EVOKER', role: 'damage' }],
]);
const spells = {
  '1': { name: 'Arcane Missiles' },
  '2': { name: 'Arcane Barrage' },
  '3': { name: 'Prismatic Bolt' },
  '4': { name: 'Touch of the Magi' },
  '5': { name: 'Arcane Orb' },
  '6': { name: 'Arcane Missiles' },
  '7': { name: 'Mirror Image' },
  '395152': { name: 'Ebon Might' },
  '409311': { name: 'Prescience' },
};
const row = (spellId: number, amount: number, kind: AbilityRow['kind'] = 'own', actorId = 4, actorName = 'Faelan-Emberfall-EU'): AbilityRow => ({
  spellId, actorId, actorName, kind, amount, support: 0, overheal: 0, hits: 1, crits: 0, maxHit: 0, ticks: 0,
});

describe('abilityBreakdown', () => {
  it('merges same-name own and pet abilities and lists the top five with "Other" after them, even when it is larger', () => {
    const missiles = [row(1, 30), row(6, 5), row(1, 5, 'pet', 40, 'Mirror Image-0')];
    const rows = abilityBreakdown([...missiles, row(2, 25), row(3, 15), row(4, 6), row(5, 5), row(7, 4), row(395152, 3, 'own', 4), row(409311, 2)], {
      total: 100,
      spells,
      roster,
    });
    expect(rows.map((r) => [r.name, r.amount, r.tone, r.share, r.barPct])).toEqual([
      ['Arcane Missiles', 40, 'normal', 0.4, 100],
      ['Arcane Barrage', 25, 'normal', 0.25, 62.5],
      ['Prismatic Bolt', 15, 'normal', 0.15, 37.5],
      ['Touch of the Magi', 6, 'normal', 0.06, 15],
      ['Arcane Orb', 5, 'normal', 0.05, 12.5],
      ['Other', 9, 'other', 0.09, 22.5],
    ]);
  });

  it("ranks an Evoker's support rows among his abilities and keeps unmatched support after \"Other\"", () => {
    const evoker = abilityBreakdown(
      [
        row(395152, 50, 'support_given', 5, 'Speronis-Stonevale-EU'),
        row(2, 38, 'own', 5, 'Speronis-Stonevale-EU'),
        row(409311, 37, 'support_given', 5, 'Speronis-Stonevale-EU'),
        row(1, 9, 'own', 5, 'Speronis-Stonevale-EU'),
        row(3, 8, 'own', 5, 'Speronis-Stonevale-EU'),
        row(4, 7, 'own', 5, 'Speronis-Stonevale-EU'),
      ],
      { total: 149, spells, roster },
    );
    expect(evoker.map((r) => [r.name, r.tone, r.amount])).toEqual([
      ['Ebon Might', 'support', 50],
      ['Arcane Barrage', 'normal', 38],
      ['Prescience', 'support', 37],
      ['Arcane Missiles', 'normal', 9],
      ['Prismatic Bolt', 'normal', 8],
      ['Other', 'other', 7],
    ]);
    const buffed = abilityBreakdown([row(1, 40), row(2, 25), row(3, 15), row(4, 12), row(5, 5), row(7, 4), row(0, -3, 'unmatched', 0, '')], { total: 98, spells, roster });
    expect(buffed.map((r) => [r.name, r.tone, r.amount, r.share])).toEqual([
      ['Arcane Missiles', 'normal', 40, 40 / 98],
      ['Arcane Barrage', 'normal', 25, 25 / 98],
      ['Prismatic Bolt', 'normal', 15, 15 / 98],
      ['Touch of the Magi', 'normal', 12, 12 / 98],
      ['Arcane Orb', 'normal', 5, 5 / 98],
      ['Other', 'other', 4, 4 / 98],
      ['Unmatched hits', 'negative', -3, null],
    ]);
  });
});

describe('takenBreakdown', () => {
  const hit = (spellId: number, amount: number, sourceName: string | null, extra: Partial<TakenAbility> = {}): TakenAbility => ({
    spellId, environmental: false, sourceName, sourceId: null, amount, absorbed: 0, hits: 1, playersHit: 1, ...extra,
  });

  it('names player sources in their class colour, merges same name and source, keeps melee and world damage apart', () => {
    const rows = takenBreakdown(
      [
        hit(1, 50, "Ula'tek"),
        hit(6, 20, "Ula'tek"),
        hit(2, 30, 'Faelan-Emberfall-EU', { sourceId: 4 }),
        hit(0, 10, 'Gore Rattle'),
        hit(0, 5, null, { environmental: true }),
        hit(3, 4, null),
        hit(4, 3, null),
        hit(5, 2, null),
      ],
      { total: 124, spells, roster },
    );
    expect(rows.map((r) => [r.name, r.note, r.noteColor, r.amount])).toEqual([
      ['Arcane Missiles', "Ula'tek", null, 70],
      ['Arcane Barrage', 'Faelan', 'var(--class-mage)', 30],
      ['Melee', 'Gore Rattle', null, 10],
      ['Environmental damage', 'Environment', null, 5],
      ['Prismatic Bolt', 'Unknown source', null, 4],
      ['Other', null, null, 5],
    ]);
    expect(rows[2].icon).toBe(namedIcon('ability_meleedamage'));
  });
});
