import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dimension, FilterOption } from '../../api/types';
import { initialState, useApp } from '../../store';
import { overviewFixture } from '../../test/overviewFixture';
import { PageFilter } from './PageFilter';

vi.mock('../../api/client', () => ({ api: {} }));

const option = (o: Pick<FilterOption, 'value' | 'name'> & Partial<FilterOption>): FilterOption => ({
  number: null,
  npcId: null,
  instances: [],
  pets: [],
  primarySpell: null,
  variants: [],
  ...o,
});
const variant = (spellId: number) => ({ spellId, casts: 0, hits: 1, heals: 0, auras: 0 });
const ULATEK = option({
  value: { kind: 'unit', unit: { kind: 'unit', name: "Ula'tek" } },
  name: "Ula'tek",
  instances: [{ actorId: 31, number: 1 }, { actorId: 32, number: 2 }],
});
const BARRAGE = option({
  value: { kind: 'ability', ability: { kind: 'name', name: 'Arcane Barrage' } },
  name: 'Arcane Barrage',
  primarySpell: 44425,
  variants: [variant(44425), variant(44426)],
});

const openPlayer = vi.fn(async () => {});
const openTarget = vi.fn(async () => {});

function withOptions(byDimension: Partial<Record<Dimension, FilterOption[]>>) {
  return vi.fn(async (dimension: Dimension) => byDimension[dimension] ?? []);
}

beforeEach(() => {
  useApp.setState({ ...initialState(), tab: 'damage', overview: overviewFixture, openPlayer, openTarget });
  openPlayer.mockClear();
  openTarget.mockClear();
});

describe('PageFilter', () => {
  it('names an enemy instance and a spell variant from the view picker options under Enemies', async () => {
    useApp.setState({
      filterOptions: withOptions({ source: [ULATEK], ability: [BARRAGE] }),
      filters: { perspective: 'enemy', own: [{ kind: 'instance', actorId: 32 }], other: [], ability: [{ kind: 'id', spellId: 44426 }] },
    });
    render(<PageFilter dimensions={['target', 'ability']} />);
    expect(await screen.findByText("Ula'tek #2")).toBeInTheDocument();
    expect(await screen.findByText('Arcane Barrage › ID 44426')).toBeInTheDocument();
  });

  it('links a selected player and enemy to their detail pages', async () => {
    useApp.setState({
      filterOptions: withOptions({ target: [ULATEK] }),
      filters: { perspective: 'friendly', own: [{ kind: 'player', actorId: 3 }], other: [{ kind: 'instance', actorId: 32 }], ability: [] },
    });
    render(<PageFilter dimensions={['source', 'target']} />);
    await userEvent.click(await screen.findByRole('button', { name: "Ula'tek #2" }));
    expect(openTarget).toHaveBeenCalledWith("Ula'tek");
    await userEvent.click(screen.getByRole('button', { name: 'Wendel' }));
    expect(openPlayer).toHaveBeenCalledWith(3);
  });
});
