import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { TabBar } from './TabBar';

vi.mock('../../api/client', () => ({ api: {} }));

beforeEach(() => {
  localStorage.clear();
  useApp.setState(initialState());
});

describe('tab bar', () => {
  it('puts the Replay tab last, with its icon', () => {
    render(<TabBar />);
    const replay = screen.getAllByRole('tab').at(-1);
    expect(replay).toHaveAccessibleName('Replay');
    expect(replay?.querySelector('svg')).not.toBeNull();
  });

  it('offers Hide procs in the Options menu on Casts and remembers the choice', async () => {
    useApp.setState({ tab: 'casts', hideProcs: true });
    render(<TabBar />);
    await userEvent.click(screen.getByRole('button', { name: 'Options' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Hide procs' }));
    expect(useApp.getState().hideProcs).toBe(false);
    expect(localStorage.getItem('openlogs.hideProcs')).toBe('false');
  });

  it.each(['overview', 'casts'] as const)('keeps Aug credit unavailable on %s, which it does not affect', async (tab) => {
    useApp.setState({ tab });
    render(<TabBar />);
    await userEvent.click(screen.getByRole('button', { name: 'Options' }));
    expect(screen.getByRole('checkbox', { name: /Credit Aug support to the Evoker/ })).toBeDisabled();
  });
});
