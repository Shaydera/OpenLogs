import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PlayerRef } from '../../api/types';
import type { BreakdownRow } from './breakdown';
import { RankedRow, SideBreakdown } from './ReportParts';

const FAELAN: PlayerRef = { actorId: 4, name: 'Faelan-Emberfall-EU', specId: 62, specName: 'Arcane Mage', classId: 8, classToken: 'MAGE', role: 'damage' };

describe('RankedRow', () => {
  it('previews on hovering the name and on focus, closes on leaving and Escape, and selects on click', async () => {
    const onPreview = vi.fn();
    const onSelect = vi.fn();
    render(<RankedRow rank={1} player={FAELAN} barPct={100} total="1" selected={false} onSelect={onSelect} onPreview={onPreview} />);
    const row = screen.getByRole('button');
    const name = within(row).getByText('Faelan');
    await userEvent.hover(name);
    expect(onPreview).toHaveBeenLastCalledWith(expect.any(HTMLElement), row);
    await userEvent.unhover(name);
    expect(onPreview).toHaveBeenLastCalledWith(null, null);
    row.focus();
    expect(onPreview).toHaveBeenLastCalledWith(expect.any(HTMLElement), row);
    await userEvent.keyboard('{Escape}');
    expect(onPreview).toHaveBeenLastCalledWith(null, null);
    await userEvent.click(row);
    expect(onSelect).toHaveBeenCalled();
    expect(onPreview).toHaveBeenLastCalledWith(null, null);
  });
});

describe('SideBreakdown', () => {
  it('lists abilities with amount and share, deductions without a share', () => {
    const rows: BreakdownRow[] = [
      { key: 'a', tone: 'support', icon: 'x.png', name: 'Ebon Might', note: null, noteColor: null, amount: 30_174_060, share: 0.241, barPct: 100 },
      { key: 'b', tone: 'other', icon: null, name: 'Other', note: null, noteColor: null, amount: 7_340_000, share: 0.059, barPct: 24.3 },
      { key: 'c', tone: 'negative', icon: null, name: 'Own buff share (deducted)', note: null, noteColor: null, amount: -177_437, share: null, barPct: 0.6 },
    ];
    render(<SideBreakdown caption="Abilities of Speronis" amountLabel="Damage" rows={rows} />);
    const table = screen.getByRole('table', { name: 'Abilities of Speronis' });
    const cells = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell').slice(2).map((cell) => cell.textContent));
    expect(cells).toEqual([
      ['30.17M', '24.1%'],
      ['7.34M', '5.9%'],
      ['−0.18M', ''],
    ]);
    expect(within(table).getByText('Support')).toBeInTheDocument();
  });
});
