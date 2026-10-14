import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { HEALTH } from '../../api/types';
import { resourcesReportFixture } from '../../test/reportFixtures';
import { ResourcesTab } from './ResourcesTab';

vi.mock('../../api/client', () => ({ api: {} }));

const openPlayer = vi.fn(async () => {});

beforeEach(() => {
  useApp.setState({ ...initialState(), tab: 'resources', openPlayer, filterOptions: vi.fn(async () => []) });
  openPlayer.mockClear();
});

describe('ResourcesTab', () => {
  it("lists the players with their average and shows the selected player's powers", async () => {
    render(<ResourcesTab report={resourcesReportFixture} />);
    const rows = within(screen.getByRole('group', { name: 'Players · 2' })).getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual(['FaelanArcane Mage · Mana, Arcane Charges82.5%', 'WendelArms Warrior · Rage16.7%']);
    const mana = screen.getByRole('region', { name: 'Mana' });
    expect(within(mana).getByRole('group', { name: 'Mana key figures' })).toHaveTextContent('Average82.5%Minimum50.0%Time at cap10.0 sGained50.00kWasted10.00k');
    expect(within(within(mana).getByRole('table', { name: 'Gains of Mana' })).getAllByRole('row')[1]).toHaveTextContent('Evocation50.00k10.00k');
    await userEvent.click(screen.getByRole('button', { name: 'Player details →' }));
    expect(openPlayer).toHaveBeenCalledWith(4);
    await userEvent.click(rows[1]);
    expect(screen.getByRole('heading', { level: 2, name: 'Wendel · resources' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Rage: average 16.7%' })).toBeInTheDocument();
  });

  it("shows one selected player's resources as the page, without a list", () => {
    useApp.setState({ filters: { ...initialState().filters, own: [{ kind: 'player', actorId: 3 }] } });
    render(<ResourcesTab report={{ ...resourcesReportFixture, units: resourcesReportFixture.units.slice(1) }} />);
    expect(screen.queryByRole('group', { name: /Players/ })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Wendel · resources' })).toBeInTheDocument();
  });

  describe('enemies', () => {
    const health = (avgPct: number) => ({ ...resourcesReportFixture.units[1].tracks[0], powerType: HEALTH, avgPct });
    const enemy = (actorId: number, name: string, number: number, boss: boolean, avgPct: number) => ({
      unit: { unit: { kind: 'instance' as const, actorId }, name, number },
      boss,
      dead: [],
      tracks: [health(avgPct)],
    });
    const enemies = {
      ...resourcesReportFixture,
      units: [
        enemy(21, 'Blightscale Rawling', 10, false, 30),
        enemy(20, 'Blightscale Rawling', 2, false, 40),
        enemy(9, "Ula'tek", 1, true, 50),
        enemy(30, 'Abyssal Lasher', 1, false, 60),
        enemy(31, 'Venomous Snapper', 1, false, 70),
      ],
    };

    beforeEach(() => useApp.setState({ filters: { ...initialState().filters, perspective: 'enemy' } }));

    it('lists the bosses first, then the other units by name, several of a name in a collapsed group', async () => {
      render(<ResourcesTab report={enemies} />);
      const list = screen.getByRole('group', { name: 'Enemies · 5' });
      const rows = within(list).getAllByRole('button');
      expect(rows.map((r) => [r.textContent, r.getAttribute('aria-expanded')])).toEqual([
        ["UUla'tek #1Health50.0%", null],
        ['ALAbyssal Lasher #1Health60.0%', null],
        ['▸Blightscale Rawling · 2', 'false'],
        ['VSVenomous Snapper #1Health70.0%', null],
      ]);
      expect(screen.getByRole('heading', { level: 2, name: "Ula'tek #1 · resources" })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Player details →' })).toBeNull();

      rows[2].focus();
      await userEvent.keyboard('{Enter}');
      expect(rows[2]).toHaveAttribute('aria-expanded', 'true');
      const instances = within(within(list).getByRole('group', { name: 'Blightscale Rawling' })).getAllByRole('button');
      expect(instances.map((r) => r.textContent)).toEqual(['BR#2Health40.0%', 'BR#10Health30.0%']);

      await userEvent.click(instances[1]);
      expect(screen.getByRole('heading', { level: 2, name: 'Blightscale Rawling #10 · resources' })).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Health: average 30.0%' })).toBeInTheDocument();
    });

    it('opens the group of the unit it selects for you and marks a collapsed group that holds the selection', async () => {
      render(<ResourcesTab report={{ ...enemies, units: enemies.units.filter((u) => u.unit.name === 'Blightscale Rawling') }} />);
      const list = screen.getByRole('group', { name: 'Enemies · 2' });
      expect(within(list).getByRole('button', { name: /#2/ })).toHaveAttribute('aria-pressed', 'true');
      const head = within(list).getByRole('button', { name: 'Blightscale Rawling · 2' });
      await userEvent.click(head);
      expect(head).toHaveAttribute('aria-expanded', 'false');
      expect(head).toHaveAttribute('aria-current', 'true');
    });

    it("builds a unit's monogram from its name, not its number", () => {
      render(<ResourcesTab report={enemies} />);
      const boss = within(screen.getByRole('group', { name: 'Enemies · 5' })).getByRole('button', { name: /Ula'tek/ });
      expect(boss.firstChild).toHaveTextContent(/^U$/);
    });
  });
});
