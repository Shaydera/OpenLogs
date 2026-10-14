import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CastsReport } from '../../api/types';
import { initialState, useApp } from '../../store';
import { castsReportFixture } from '../../test/reportFixtures';
import { CastsTab } from './CastsTab';

vi.mock('../../api/client', () => ({ api: {} }));

const openPlayer = vi.fn(async () => {});
const openAbilityOf = vi.fn(async () => {});
const select = vi.fn(async () => {});

beforeEach(() => {
  localStorage.clear();
  useApp.setState({ ...initialState(), tab: 'casts', openPlayer, openAbilityOf, select, filterOptions: vi.fn(async () => []) });
  openPlayer.mockClear();
  openAbilityOf.mockClear();
  select.mockClear();
});

const list = () => screen.getByRole('group', { name: 'Casts by player' });
const pick = (name: string) => userEvent.click(within(list()).getByRole('button', { name: new RegExp(name) }));
const spellRows = (name: string) => within(screen.getByRole('table', { name: `Spell casts of ${name}` })).getAllByRole('row').slice(1);
const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((cell) => cell.textContent);
const [faelan, pyrrin] = castsReportFixture.breakdown.rows;

describe('CastsTab', () => {
  it("lists casters by casts and links the selected player's spells to their ability pages", async () => {
    render(<CastsTab report={castsReportFixture} />);
    const rows = within(list()).getAllByRole('button');
    expect(rows.map((row) => row.textContent)).toEqual(['FaelanDPS4020.01', 'PyrrinHeal3618.02']);
    expect(rows[0]).toHaveAttribute('aria-pressed', 'true');
    await pick('Pyrrin');
    await userEvent.click(screen.getByRole('button', { name: 'Rejuvenation' }));
    expect(openAbilityOf).toHaveBeenCalledWith(2, 774, 'healing');
    expect(screen.queryByRole('button', { name: 'Regrowth' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Player details →' }));
    expect(openPlayer).toHaveBeenCalledWith(2);
    await userEvent.click(screen.getByRole('button', { name: 'Show only Pyrrin' }));
    expect(select).toHaveBeenCalledWith('source', { kind: 'player', actorId: 2 });
  });

  it('sorts spells with missing uptimes last in both directions', async () => {
    render(<CastsTab report={castsReportFixture} />);
    await pick('Pyrrin');
    expect(spellRows('Pyrrin').map(cells)).toEqual([
      ['', 'Rejuvenation', '30', '80.0%', '15.0'],
      ['', 'Regrowth', '6', '—', '3.0'],
    ]);
    const table = screen.getByRole('table', { name: 'Spell casts of Pyrrin' });
    await userEvent.click(within(table).getByRole('button', { name: 'Uptime %' }));
    await userEvent.click(within(table).getByRole('button', { name: 'Uptime % ↓' }));
    expect(within(table).getByRole('button', { name: 'Uptime % ↑' })).toBeInTheDocument();
    expect(spellRows('Pyrrin').map((row) => cells(row)[1])).toEqual(['Rejuvenation', 'Regrowth']);
  });

  it("shows one selected player's spells as the table, without a list of casters", async () => {
    useApp.setState({ filters: { ...initialState().filters, own: [{ kind: 'player', actorId: 2 }] } });
    const spells = pyrrin.splits[0].rows.map((row) => ({ ...row, perSecond: 0, splits: [] }));
    const narrowed: CastsReport = {
      ...castsReportFixture,
      breakdown: { ...castsReportFixture.breakdown, group: 'ability', side: [], total: 36, rows: spells },
    };
    render(<CastsTab report={narrowed} />);
    expect(screen.queryByRole('group', { name: 'Casts by player' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Pyrrin · spell casts' })).toBeInTheDocument();
    expect(spellRows('Pyrrin').map((row) => cells(row)[1])).toEqual(['Rejuvenation', 'Regrowth']);
    await userEvent.click(screen.getByRole('button', { name: 'Player details →' }));
    expect(openPlayer).toHaveBeenCalledWith(2);
  });

  it('lists who cast a selected ability, without a spell table', () => {
    useApp.setState({ filters: { ...initialState().filters, ability: [{ kind: 'name', name: 'Arcane Barrage' }] } });
    const narrowed: CastsReport = {
      breakdown: { ...castsReportFixture.breakdown, side: [], total: 40, rows: [{ ...faelan, splits: [] }] },
      extras: castsReportFixture.extras.filter((e) => e.player === 4),
    };
    render(<CastsTab report={narrowed} />);
    expect(list()).toHaveTextContent('FaelanDPS4020.0');
    expect(within(list()).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('table')).toBeNull();
  });
});
