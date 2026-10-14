import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { breakdownFixture } from '../../test/reportFixtures';
import { BreakdownPanel } from './BreakdownPanel';

vi.mock('../../api/client', () => ({ api: {} }));

beforeEach(() => {
  useApp.setState({
    ...initialState(),
    tab: 'damage',
    select: vi.fn(async () => {}),
    clearFilters: vi.fn(async () => {}),
    openPlayer: vi.fn(async () => {}),
  });
});

describe('BreakdownPanel', () => {
  it('ranks rows, splits the selected one, narrows to it and opens the player page', async () => {
    render(<BreakdownPanel tab="damage" breakdown={breakdownFixture} title="Damage Done" unit="DPS" />);
    const rows = within(screen.getByRole('group', { name: 'Damage Done rows' })).getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('Wendel'), expect.stringContaining('Speronis')]);
    expect(rows[0]).toHaveTextContent('200.00k');
    const side = screen.getByRole('complementary');
    expect(within(side).getByRole('button', { name: 'Abilities' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(side).getByRole('button', { name: 'Show only Wendel' }));
    expect(useApp.getState().select).toHaveBeenCalledWith('source', { kind: 'player', actorId: 3 });
    await userEvent.click(within(side).getByRole('button', { name: /Player details/ }));
    expect(useApp.getState().openPlayer).toHaveBeenCalledWith(3);
  });

  it('offers to clear the filters when nothing matches them, and says the range has nothing without filters', async () => {
    const empty = { ...breakdownFixture, rows: [], total: 0 };
    const { rerender } = render(<BreakdownPanel tab="damage" breakdown={empty} title="Damage Done" unit="DPS" />);
    expect(screen.getByText('No damage in this range.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    useApp.setState({ filters: { ...initialState().filters, ability: [{ kind: 'name', name: 'Mortal Strike' }] } });
    rerender(<BreakdownPanel tab="damage" breakdown={empty} title="Damage Done" unit="DPS" />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(useApp.getState().clearFilters).toHaveBeenCalled();
  });

  it('falls back to the first row when the selected one is gone and shows no tabs for a single split', async () => {
    const { rerender } = render(<BreakdownPanel tab="damage" breakdown={breakdownFixture} title="Damage Done" unit="DPS" />);
    await userEvent.click(screen.getByRole('button', { name: /Speronis/ }));
    expect(within(screen.getByRole('complementary')).getByText('Ebon Might')).toBeInTheDocument();
    const onlyAbility = { ...breakdownFixture, side: ['ability' as const], rows: breakdownFixture.rows.slice(0, 1) };
    rerender(<BreakdownPanel tab="damage" breakdown={onlyAbility} title="Damage Done" unit="DPS" />);
    const side = screen.getByRole('complementary');
    expect(within(side).getByText('Mortal Strike')).toBeInTheDocument();
    expect(within(side).queryByRole('button', { name: 'Targets' })).toBeNull();
  });

  it("draws a caller's extra column and bar fill", () => {
    render(
      <BreakdownPanel
        tab="damage"
        breakdown={breakdownFixture}
        title="Damage Done"
        unit="DPS"
        extraColumns={[{ label: 'Aug Δ', render: (row) => <span className="num rrow-end">{row.name === 'Speronis' ? '+1.00M' : '±0'}</span> }]}
        fill={(row) => (row.name === 'Wendel' ? <span role="img" aria-label="split by target" /> : undefined)}
      />,
    );
    const rows = within(screen.getByRole('group', { name: 'Damage Done rows' })).getAllByRole('button');
    expect(rows[1]).toHaveTextContent('+1.00M');
    expect(within(rows[0]).getByRole('img', { name: 'split by target', hidden: true })).toBeInTheDocument();
    expect(within(rows[1]).queryByRole('img', { name: 'split by target', hidden: true })).toBeNull();
  });

  it('previews a row on hovering the name and on focus, closes on leaving, Escape and click', async () => {
    const onPreview = vi.fn();
    render(<BreakdownPanel tab="damage" breakdown={breakdownFixture} title="Damage Done" unit="DPS" onPreview={(row) => (row.name === 'Wendel' ? onPreview : undefined)} />);
    const row = within(screen.getByRole('group', { name: 'Damage Done rows' })).getByRole('button', { name: /Wendel/ });
    const name = within(row).getByText('Wendel');
    await userEvent.hover(name);
    expect(onPreview).toHaveBeenLastCalledWith(expect.any(HTMLElement), row);
    await userEvent.unhover(name);
    expect(onPreview).toHaveBeenLastCalledWith(null, null);
    row.focus();
    expect(onPreview).toHaveBeenLastCalledWith(expect.any(HTMLElement), row);
    await userEvent.keyboard('{Escape}');
    expect(onPreview).toHaveBeenLastCalledWith(null, null);
    await userEvent.click(row);
    expect(row).toHaveAttribute('aria-pressed', 'true');
    expect(onPreview).toHaveBeenLastCalledWith(null, null);
  });

  it('narrows to a row by its name and selects the row anywhere else', async () => {
    render(<BreakdownPanel tab="damage" breakdown={breakdownFixture} title="Damage Done" unit="DPS" />);
    const [wendel, speronis] = within(screen.getByRole('group', { name: 'Damage Done rows' })).getAllByRole('button');
    await userEvent.click(within(speronis).getByText('Speronis'));
    expect(useApp.getState().select).toHaveBeenCalledWith('source', { kind: 'player', actorId: 5 });
    expect(wendel).toHaveAttribute('aria-pressed', 'true');
    vi.mocked(useApp.getState().select).mockClear();
    await userEvent.click(within(speronis).getByText('100.00k'));
    expect(speronis).toHaveAttribute('aria-pressed', 'true');
    expect(useApp.getState().select).not.toHaveBeenCalled();
  });

  it('hides "Show only" and selects on a name click when the row dimension is already narrowed', async () => {
    useApp.setState({ filters: { ...initialState().filters, own: [{ kind: 'player', actorId: 3 }] } });
    render(<BreakdownPanel tab="damage" breakdown={breakdownFixture} title="Damage Done" unit="DPS" />);
    expect(screen.queryByRole('button', { name: /Show only/ })).toBeNull();
    await userEvent.click(screen.getByText('Speronis'));
    expect(screen.getByRole('button', { name: /Speronis/ })).toHaveAttribute('aria-pressed', 'true');
    expect(useApp.getState().select).not.toHaveBeenCalled();
  });
});
