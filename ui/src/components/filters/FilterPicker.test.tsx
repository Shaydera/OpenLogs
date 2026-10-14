import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterOption } from '../../api/types';
import { initialState, useApp } from '../../store';
import { FilterPicker } from './FilterPicker';

vi.mock('../../api/client', () => ({ api: {} }));

const missiles: FilterOption = {
  value: { kind: 'ability', ability: { kind: 'name', name: 'Arcane Missiles' } },
  name: 'Arcane Missiles', number: null, npcId: null, instances: [], pets: [], primarySpell: 5143,
  variants: [
    { spellId: 5143, casts: 287, hits: 0, heals: 0, auras: 0 },
    { spellId: 7268, casts: 0, hits: 4506, heals: 0, auras: 0 },
  ],
};
const barrage: FilterOption = {
  ...missiles,
  value: { kind: 'ability', ability: { kind: 'name', name: 'Arcane Barrage' } },
  name: 'Arcane Barrage',
  primarySpell: 44425,
  variants: [{ spellId: 44425, casts: 244, hits: 436, heals: 0, auras: 0 }],
};

beforeEach(() => {
  const select = vi.fn(async () => {});
  useApp.setState({ ...initialState(), filterOptions: vi.fn(async () => [missiles, barrage]), select });
});

describe('FilterPicker', () => {
  it('searches by name or spell ID and narrows to a spell or one of its variants', async () => {
    render(<FilterPicker dimension="ability" caption="Ability" allLabel="All abilities" value={null} />);
    await userEvent.click(screen.getByRole('button', { name: /Ability/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Ability' });
    await userEvent.type(within(dialog).getByRole('searchbox'), '7268');
    expect(within(dialog).queryByRole('button', { name: /Arcane Barrage/ })).toBeNull();
    expect(within(dialog).getByRole('button', { name: /^Arcane Missiles/ })).toHaveTextContent('5143');
    await userEvent.click(within(dialog).getByRole('button', { name: '1 more ID of Arcane Missiles' }));
    await userEvent.click(within(dialog).getByRole('button', { name: /7268/ }));
    expect(useApp.getState().select).toHaveBeenCalledWith('ability', { kind: 'id', spellId: 7268 });
  });

  it('picks a variant on Enter when the query is exactly its ID, the spell for its primary ID', async () => {
    render(<FilterPicker dimension="ability" caption="Ability" allLabel="All abilities" value={null} />);
    await userEvent.click(screen.getByRole('button', { name: /Ability/ }));
    await screen.findByRole('button', { name: /^Arcane Barrage/ });
    await userEvent.type(screen.getByRole('searchbox'), '7268{Enter}');
    expect(useApp.getState().select).toHaveBeenLastCalledWith('ability', { kind: 'id', spellId: 7268 });
    cleanup();
    render(<FilterPicker dimension="ability" caption="Ability" allLabel="All abilities" value={null} />);
    await userEvent.click(screen.getByRole('button', { name: /Ability/ }));
    await userEvent.type(await screen.findByRole('searchbox'), '5143{Enter}');
    expect(useApp.getState().select).toHaveBeenLastCalledWith('ability', { kind: 'name', name: 'Arcane Missiles' });
  });

  it('closes when focus leaves the picker', async () => {
    render(
      <>
        <FilterPicker dimension="ability" caption="Ability" allLabel="All abilities" value={null} />
        <button type="button">elsewhere</button>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Ability/ }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays open when focus drops to nothing, as WebKit does on a click, and closes on a click outside', async () => {
    render(
      <>
        <FilterPicker dimension="ability" caption="Ability" allLabel="All abilities" value={null} />
        <p>elsewhere</p>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Ability/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.focusOut(within(dialog).getByRole('searchbox'), { relatedTarget: null });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByText('elsewhere'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('labels a selected instance on mount without opening', async () => {
    const boss: FilterOption = {
      value: { kind: 'unit', unit: { kind: 'unit', name: 'Add' } },
      name: 'Add', number: null, npcId: 99, pets: [], primarySpell: null, variants: [],
      instances: [{ actorId: 5, number: 3 }, { actorId: 6, number: 4 }],
    };
    useApp.setState({ filterOptions: vi.fn(async () => [boss]) });
    render(<FilterPicker dimension="source" caption="Source" allLabel="All sources" value={{ kind: 'instance', actorId: 5 }} />);
    expect(await screen.findByRole('button', { name: /Add #3/ })).toBeInTheDocument();
  });

  it('moves through the list with the arrow keys and picks with Enter', async () => {
    render(<FilterPicker dimension="ability" caption="Ability" allLabel="All abilities" value={null} />);
    await userEvent.click(screen.getByRole('button', { name: /Ability/ }));
    await screen.findByRole('button', { name: /^Arcane Barrage/ });
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');
    expect(useApp.getState().select).toHaveBeenCalledWith('ability', { kind: 'name', name: 'Arcane Barrage' });
  });
});
