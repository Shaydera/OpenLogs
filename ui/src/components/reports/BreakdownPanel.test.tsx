import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Breakdown, GroupedRow, UnitRef } from '../../api/types';
import { initialState, useApp } from '../../store';
import { breakdownFixture } from '../../test/reportFixtures';
import { BreakdownPanel } from './BreakdownPanel';

vi.mock('../../api/client', () => ({ api: {} }));

beforeEach(() => {
  useApp.setState({
    ...initialState(),
    tab: 'damage',
    showOnly: vi.fn(async () => {}),
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
    expect(useApp.getState().showOnly).toHaveBeenCalledWith('source', expect.objectContaining({ name: 'Wendel' }));
    await userEvent.click(within(side).getByRole('button', { name: 'Open player details' }));
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

  it("opens the player page from a player's name and selects the row anywhere else", async () => {
    render(<BreakdownPanel tab="damage" breakdown={breakdownFixture} title="Damage Done" unit="DPS" />);
    const [wendel, speronis] = within(screen.getByRole('group', { name: 'Damage Done rows' })).getAllByRole('button');
    await userEvent.click(within(speronis).getByText('Speronis'));
    expect(useApp.getState().openPlayer).toHaveBeenCalledWith(5);
    expect(useApp.getState().showOnly).not.toHaveBeenCalled();
    expect(wendel).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(speronis).getByText('100.00k'));
    expect(speronis).toHaveAttribute('aria-pressed', 'true');
    expect(useApp.getState().openPlayer).toHaveBeenCalledTimes(1);
  });

  it("narrows to a player from the name in a pull set, which has no player pages", async () => {
    useApp.setState({ view: { kind: 'set', set: { kind: 'all', encounterId: 3492, difficulty: 15, fights: [1, 3] } } });
    render(<BreakdownPanel tab="damage" breakdown={breakdownFixture} title="Damage Done" unit="DPS" />);
    const [, speronis] = within(screen.getByRole('group', { name: 'Damage Done rows' })).getAllByRole('button');
    await userEvent.click(within(speronis).getByText('Speronis'));
    expect(useApp.getState().showOnly).toHaveBeenCalledWith('source', expect.objectContaining({ name: 'Speronis' }));
    expect(within(screen.getByRole('complementary')).queryByRole('button', { name: 'Open player details' })).toBeNull();
    expect(useApp.getState().openPlayer).not.toHaveBeenCalled();
  });

  it('names the pets behind a pet ability row and narrows to the ability and those pets', async () => {
    const wolves: UnitRef[] = [{ kind: 'pet', owner: 3, name: 'Wolf' }];
    const melee = (pet: string | null, amount: number, pets: UnitRef[]): GroupedRow => ({
      key: { kind: 'ability', ability: { kind: 'id', spellId: 0 }, rowKind: 'own', pet },
      name: '',
      number: null,
      spellId: 0,
      amount,
      share: amount / 1_000,
      absorbed: 0,
      healAbsorbed: 0,
      overheal: 0,
      healed: 0,
      hits: 1,
      crits: 0,
      casts: 0,
      hitAmount: 0,
      ticks: 0,
      tickAmount: 0,
      misses: [],
      pets,
      perSecond: amount,
      splits: [],
    });
    const byAbility: Breakdown = { ...breakdownFixture, group: 'ability', side: ['target'], rows: [melee('Wolf', 600, wolves), melee(null, 400, [])] };
    render(<BreakdownPanel tab="damage" breakdown={byAbility} title="Damage Done" unit="DPS" />);
    const [wolf, own] = within(screen.getByRole('group', { name: 'Damage Done rows' })).getAllByRole('button');
    expect(within(wolf).getByText('Wolf')).toBeInTheDocument();
    expect(within(own).queryByText('Wolf')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show only Melee by Wolf' }));
    expect(useApp.getState().showOnly).toHaveBeenCalledWith('ability', expect.objectContaining({ pets: wolves }));
  });

  it('narrows to an ability by its name, and only selects it once abilities are narrowed', async () => {
    const byAbility = { ...breakdownFixture, group: 'ability' as const, side: [], rows: breakdownFixture.rows.map((row) => ({ ...row.splits[0].rows[0], perSecond: 0, splits: [] })) };
    const { unmount } = render(<BreakdownPanel tab="damage" breakdown={byAbility} title="Damage Done" unit="DPS" />);
    await userEvent.click(screen.getByText('Ebon Might'));
    expect(useApp.getState().showOnly).toHaveBeenCalledWith('ability', expect.objectContaining({ name: 'Ebon Might' }));
    unmount();
    vi.mocked(useApp.getState().showOnly).mockClear();
    useApp.setState({ filters: { ...initialState().filters, ability: [{ kind: 'name', name: 'Mortal Strike' }] } });
    render(<BreakdownPanel tab="damage" breakdown={byAbility} title="Damage Done" unit="DPS" />);
    expect(screen.queryByRole('button', { name: /Show only/ })).toBeNull();
    await userEvent.click(screen.getByText('Ebon Might'));
    expect(screen.getByRole('button', { name: /Ebon Might/ })).toHaveAttribute('aria-pressed', 'true');
    expect(useApp.getState().showOnly).not.toHaveBeenCalled();
  });
});
