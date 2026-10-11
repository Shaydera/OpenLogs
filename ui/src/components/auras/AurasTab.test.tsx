import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { aurasReportFixture } from '../../test/reportFixtures';
import { AurasTab } from './AurasTab';

vi.mock('../../api/client', () => ({ api: {} }));

const setAuraScope = vi.fn(async () => {});

beforeEach(() => {
  useApp.setState({ ...initialState(), setAuraScope });
  setAuraScope.mockClear();
});

const auraRows = () => within(screen.getByRole('table', { name: 'Auras' })).getAllByRole('row').slice(1);

describe('AurasTab', () => {
  it('lists the auras and expands one into per-target lanes', async () => {
    render(<AurasTab report={aurasReportFixture} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Buffs on players' })).toBeInTheDocument();
    expect(auraRows().map((r) => r.textContent)).toEqual(['Arcane Intellect100.0%24', 'Power Infusion75.0%11', 'Bloodlust40.0%22']);
    await userEvent.click(screen.getByRole('button', { name: 'Bloodlust' }));
    expect(screen.getByRole('button', { name: 'Bloodlust' })).toHaveAttribute('aria-expanded', 'true');
    const lanes = screen.getByRole('list', { name: 'Targets of Bloodlust' });
    expect(within(lanes).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Faelan40.0%', 'Wendel40.0%']);
  });

  it('sorts by a column and switches the scope', async () => {
    render(<AurasTab report={aurasReportFixture} />);
    await userEvent.click(screen.getByRole('button', { name: 'Applications' }));
    expect(auraRows().map((r) => within(r).getAllByRole('button')[0].textContent)).toEqual(['Arcane Intellect', 'Bloodlust', 'Power Infusion']);
    await userEvent.click(screen.getByRole('button', { name: 'Debuffs on enemies' }));
    expect(setAuraScope).toHaveBeenCalledWith('debuffs_on_enemies');
  });
});
