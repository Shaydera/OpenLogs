import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FightRow } from '../../api/types';
import { initialState, useApp } from '../../store';
import { OptionsMenu } from './OptionsMenu';

vi.mock('../../api/client', () => ({ api: {} }));

beforeEach(() => {
  const setAttribution = vi.fn(async (attribution) => useApp.setState({ attribution }));
  const setIncludeOverkill = vi.fn(async (includeOverkill) => useApp.setState({ includeOverkill }));
  const setDeathCutoff = vi.fn(async (deathCutoff) => useApp.setState({ deathCutoff }));
  useApp.setState({ ...initialState(), tab: 'damage', attribution: 'reattributed', setAttribution, setIncludeOverkill, setDeathCutoff });
});

describe('OptionsMenu', () => {
  it('turns Aug credit off for the whole pull and marks the button', async () => {
    render(<OptionsMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Options' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Credit Aug support to the Evoker/ }));
    expect(useApp.getState().setAttribution).toHaveBeenCalledWith('augmented');
    expect(screen.getByRole('button', { name: /Options · Aug support stays with the buffed player/ })).toBeInTheDocument();
  });

  it('includes overkill and marks the button', async () => {
    render(<OptionsMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Options' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Include overkill/ }));
    expect(useApp.getState().setIncludeOverkill).toHaveBeenCalledWith(true);
    expect(screen.getByRole('button', { name: 'Options · Overkill included' })).toBeInTheDocument();
  });

  it('disables Aug credit where the view does not depend on it', async () => {
    useApp.setState({ filters: { ...initialState().filters, perspective: 'enemy' } });
    render(<OptionsMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Options' }));
    expect(screen.getByRole('checkbox', { name: /Credit Aug support to the Evoker/ })).toBeDisabled();
  });

  it('disables Hide procs for enemies, whose procs are unknown', async () => {
    useApp.setState({ tab: 'casts', filters: { ...initialState().filters, perspective: 'enemy' } });
    render(<OptionsMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Options' }));
    expect(screen.getByRole('checkbox', { name: 'Hide procs' })).toBeDisabled();
  });

  it('offers Hide procs in its own Casts section in every view and the table options only in the table', async () => {
    useApp.setState({ tab: 'casts', reportView: 'timeline' });
    const { unmount } = render(<OptionsMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Options' }));
    expect(within(screen.getByRole('region', { name: 'Casts' })).getByRole('checkbox', { name: 'Hide procs' })).toBeEnabled();
    unmount();
    useApp.setState({ tab: 'damage', reportView: 'events' });
    render(<OptionsMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Options' }));
    expect(screen.queryByRole('checkbox', { name: 'Aug difference column' })).toBeNull();
  });

  it('closes on Escape and when focus leaves', async () => {
    render(<OptionsMenu />);
    const button = screen.getByRole('button', { name: 'Options' });
    await userEvent.click(button);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
    await userEvent.click(button);
    await userEvent.click(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  describe('death cutoff', () => {
    const raidLog = { fights: [{ index: 1, run: null }] } as unknown as ReturnType<typeof useApp.getState>['log'];
    const runLog = { fights: [{ index: 1, run: { key: 'r' } as unknown as FightRow['run'] }] } as unknown as ReturnType<typeof useApp.getState>['log'];

    async function openInput() {
      render(<OptionsMenu />);
      await userEvent.click(screen.getByRole('button', { name: 'Options' }));
      return screen.queryByRole('spinbutton', { name: 'Stop at player death' });
    }

    it('shows the cutoff input on a raid pull', async () => {
      useApp.setState({ log: raidLog, view: { kind: 'fight', fightIndex: 1 } });
      expect(await openInput()).toBeInTheDocument();
    });

    it('offers no cutoff input on a whole run', async () => {
      useApp.setState({ log: runLog, view: { kind: 'fight', fightIndex: 1 } });
      expect(await openInput()).toBeNull();
    });

    it('turns the cutoff on at a death number and off again when the field is emptied', async () => {
      useApp.setState({ log: raidLog, view: { kind: 'fight', fightIndex: 1 } });
      const input = (await openInput())!;
      await userEvent.type(input, '12{Enter}');
      expect(useApp.getState().setDeathCutoff).toHaveBeenCalledTimes(1);
      expect(useApp.getState().setDeathCutoff).toHaveBeenLastCalledWith(12);
      await userEvent.clear(input);
      await userEvent.tab();
      expect(useApp.getState().setDeathCutoff).toHaveBeenLastCalledWith(null);
    });

    it.each(['0', '-2', '1.5', '1000'])('treats %s as off', async (text) => {
      useApp.setState({ log: raidLog, view: { kind: 'fight', fightIndex: 1 }, deathCutoff: 4 });
      const input = (await openInput())!;
      await userEvent.clear(input);
      await userEvent.type(input, `${text}{Enter}`);
      expect(useApp.getState().setDeathCutoff).toHaveBeenLastCalledWith(null);
    });

    it('keeps a typed cutoff when a click outside closes the menu', async () => {
      useApp.setState({ log: raidLog, view: { kind: 'fight', fightIndex: 1 } });
      const input = (await openInput())!;
      await userEvent.type(input, '3');
      await userEvent.click(document.body);
      expect(useApp.getState().setDeathCutoff).toHaveBeenLastCalledWith(3);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('discards a typed cutoff on Escape', async () => {
      useApp.setState({ log: raidLog, view: { kind: 'fight', fightIndex: 1 }, deathCutoff: 3 });
      const input = (await openInput())!;
      await userEvent.clear(input);
      await userEvent.type(input, '1{Escape}');
      expect(useApp.getState().setDeathCutoff).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('does not reload when the committed value is unchanged', async () => {
      useApp.setState({ log: raidLog, view: { kind: 'fight', fightIndex: 1 } });
      const input = (await openInput())!;
      await userEvent.type(input, '3{Enter}');
      await userEvent.tab();
      expect(useApp.getState().setDeathCutoff).toHaveBeenCalledTimes(1);
    });
  });
});
