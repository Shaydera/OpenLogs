import { describe, expect, it } from 'vitest';
import type { AuraRow } from '../../api/types';
import { aurasReportFixture } from '../../test/reportFixtures';
import { rosterIndex } from '../reports/reportData';
import { auraColour, sortAuras } from './auraModel';

const roster = rosterIndex(aurasReportFixture.roster);
const name = (row: AuraRow) => row.name;

describe('auraColour', () => {
  it('colours bars by a single source, else neutral, and debuffs on friendlies as damage taken', () => {
    expect(auraColour([4], 'buffs', 'friendly', roster)).toBe('var(--class-mage)');
    expect(auraColour([2], 'buffs', 'friendly', roster)).toBe('var(--class-druid)');
    expect(auraColour([], 'buffs', 'friendly', roster)).toBe('var(--faint)');
    expect(auraColour([4, 3], 'debuffs', 'enemy', roster)).toBe('var(--faint)');
    expect(auraColour([99], 'buffs', 'enemy', roster)).toBe('var(--faint)');
    expect(auraColour([4], 'debuffs', 'friendly', roster)).toBe('var(--wipe)');
  });
});

describe('sortAuras', () => {
  it('sorts by uptime, lanes or applications, ties by name', () => {
    const names = (sort: 'uptime' | 'targets' | 'applications') => sortAuras(aurasReportFixture.rows, sort, name).map(name);
    expect(names('uptime')).toEqual(['Arcane Intellect', 'Power Infusion', 'Bloodlust']);
    expect(names('targets')).toEqual(['Arcane Intellect', 'Bloodlust', 'Power Infusion']);
    expect(names('applications')).toEqual(['Arcane Intellect', 'Bloodlust', 'Power Infusion']);
  });
});
