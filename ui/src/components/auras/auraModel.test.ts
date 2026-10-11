import { describe, expect, it } from 'vitest';
import { aurasReportFixture } from '../../test/reportFixtures';
import { rosterIndex } from '../reports/reportData';
import { auraColour, sortAuras } from './auraModel';

const roster = rosterIndex(aurasReportFixture.roster);
const [intellect, lust, infusion] = aurasReportFixture.rows;
const name = (id: number) => aurasReportFixture.spells[String(id)]?.name ?? '?';

describe('auraColour', () => {
  it('colours bars by a single source, else neutral, and debuffs on players as damage taken', () => {
    expect(auraColour(intellect, 'buffs_on_players', roster)).toBe('var(--class-mage)');
    expect(auraColour(infusion, 'buffs_on_players', roster)).toBe('var(--class-druid)');
    expect(auraColour(lust, 'buffs_on_players', roster)).toBe('var(--faint)');
    expect(auraColour({ ...intellect, sources: [4, 3] }, 'debuffs_on_enemies', roster)).toBe('var(--faint)');
    expect(auraColour({ ...intellect, sources: [99] }, 'buffs_on_players', roster)).toBe('var(--faint)');
    expect(auraColour(intellect, 'debuffs_on_players', roster)).toBe('var(--wipe)');
  });
});

describe('sortAuras', () => {
  it('sorts by uptime, targets or applications, ties by name', () => {
    const names = (sort: 'uptime' | 'targets' | 'applications') => sortAuras(aurasReportFixture.rows, sort, name).map((r) => name(r.spellId));
    expect(names('uptime')).toEqual(['Arcane Intellect', 'Power Infusion', 'Bloodlust']);
    expect(names('targets')).toEqual(['Arcane Intellect', 'Bloodlust', 'Power Infusion']);
    expect(names('applications')).toEqual(['Arcane Intellect', 'Bloodlust', 'Power Infusion']);
  });
});
