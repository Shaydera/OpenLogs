import { act, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { overviewFixture } from '../../test/overviewFixture';
import { ConsumablesPanel } from './ConsumablesPanel';

vi.mock('../../api/client', () => ({ api: {} }));

beforeEach(() => useApp.setState(initialState()));

describe('ConsumablesPanel', () => {
  it('splits the roster into two tables and flags a missing combat potion only over the whole pull', () => {
    render(<ConsumablesPanel overview={overviewFixture} />);
    const tables = screen.getAllByRole('table');
    expect(tables.map((table) => within(table).getAllByRole('rowheader').map((cell) => cell.textContent))).toEqual([
      ['Edrin', 'Pyrrin'],
      ['Faelan', 'Wendel'],
    ]);
    const pyrrin = screen.getByRole('row', { name: /^Pyrrin/ });
    expect(within(screen.getByRole('row', { name: /^Wendel/ })).getByText('2:06')).toBeInTheDocument();
    expect(within(pyrrin).getByText('0 · missing')).toBeInTheDocument();

    act(() => useApp.setState({ range: { startMs: 180_000, endMs: 240_000 } }));
    expect(screen.queryByText('0 · missing')).not.toBeInTheDocument();
  });
});
