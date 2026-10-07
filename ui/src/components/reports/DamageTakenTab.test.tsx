import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { takenReportFixture } from '../../test/reportFixtures';
import { DamageTakenTab } from './DamageTakenTab';

vi.mock('../../api/client', () => ({ api: {} }));

beforeEach(() => useApp.setState(initialState()));

describe('DamageTakenTab', () => {
  it("breaks the selected player's damage taken down by ability and source and lists the raid's damage by ability", async () => {
    render(<DamageTakenTab report={takenReportFixture} />);
    const raid = screen.getByRole('table', { name: 'Damage taken by ability' });
    expect(within(raid).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').slice(2).map((cell) => cell.textContent))).toEqual([
      ['2.00M', '0.10M', '12', '6'],
      ['1.00M', '0.00M', '4', '1'],
    ]);
    await userEvent.click(within(screen.getByRole('group', { name: 'Damage taken by player' })).getByRole('button', { name: /Wendel/ }));
    const side = screen.getByRole('table', { name: 'Damage taken by Wendel' });
    expect(within(side).getByText('Melee')).toBeInTheDocument();
    expect(within(side).getByText('Gore Rattle')).toBeInTheDocument();
  });
});
