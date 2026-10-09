import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { playerDetailFixture } from '../../test/reportFixtures';
import { CastsAndBuffs } from './CastsAndBuffs';
import { PlayerSidePanels } from './PlayerSidePanels';

vi.mock('../../api/client', () => ({ api: {} }));

beforeEach(() => {
  useApp.setState(initialState());
});

describe('CastsAndBuffs', () => {
  it('shows each cooldown cast and the buffs with their uptime and intervals', () => {
    render(<CastsAndBuffs detail={playerDetailFixture} />);
    const cooldowns = within(screen.getByRole('list', { name: 'Cooldowns & defensives' })).getAllByRole('listitem');
    expect(cooldowns).toHaveLength(2);
    expect(within(cooldowns[0]).getAllByRole('img', { name: /^Arcane Surge at/ })).toHaveLength(2);
    expect(cooldowns[0]).toHaveTextContent('2×');
    const buffs = within(screen.getByRole('list', { name: 'Buffs' })).getAllByRole('listitem');
    expect(buffs[0]).toHaveTextContent('Ebon Mightfrom Speronis76.6%');
    expect(screen.getByRole('img', { name: 'Ebon Might: 0:00–0:06, 0:07–0:16.' })).toBeInTheDocument();
  });
});

describe('PlayerSidePanels', () => {
  it('tells the death with its burst, context and rezzer', () => {
    render(<PlayerSidePanels detail={playerDetailFixture} />);
    const death = screen.getByRole('region', { name: 'Death' });
    expect(death).toHaveTextContent('2× Virulent Spit within 1.0 s.');
    expect(death).toHaveTextContent('0:16 · Rebirth by Pyrrin · 4 s dead');
  });
});
