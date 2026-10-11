import { describe, expect, it } from 'vitest';
import { interruptsReportFixture } from '../../test/reportFixtures';
import { kickPlayers, mostInterrupted } from './kickModel';

const names: Record<number, string> = { 2: 'Pyrrin', 3: 'Wendel', 4: 'Faelan' };
const nameOf = (id: number) => names[id] ?? '';

describe('kickModel', () => {
  it('counts interrupts and dispels per player, most actions first, then interrupts, then name', () => {
    expect(kickPlayers(interruptsReportFixture, nameOf)).toEqual([
      { player: 4, interrupts: 1, dispels: 0 },
      { player: 3, interrupts: 1, dispels: 0 },
      { player: 2, interrupts: 0, dispels: 1 },
    ]);
  });

  it('finds the spell interrupted most often, the earlier one on a tie', () => {
    expect(mostInterrupted(interruptsReportFixture)).toEqual({ spellId: 5, count: 2 });
    const tie = { ...interruptsReportFixture, interrupts: [{ ...interruptsReportFixture.interrupts[0], interruptedId: 7 }, interruptsReportFixture.interrupts[1]] };
    expect(mostInterrupted(tie)).toEqual({ spellId: 7, count: 1 });
    expect(mostInterrupted({ ...interruptsReportFixture, interrupts: [] })).toBeNull();
  });
});
