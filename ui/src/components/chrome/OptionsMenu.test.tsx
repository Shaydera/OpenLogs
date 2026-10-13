import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { OptionsMenu } from './OptionsMenu';

vi.mock('../../api/client', () => ({ api: {} }));

beforeEach(() => {
  const setAttribution = vi.fn(async (attribution) => useApp.setState({ attribution }));
  useApp.setState({ ...initialState(), tab: 'damage', attribution: 'reattributed', setAttribution });
});

describe('OptionsMenu', () => {
  it('turns Aug credit off for the whole pull and marks the button', async () => {
    render(<OptionsMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Options' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Credit Aug support to the Evoker/ }));
    expect(useApp.getState().setAttribution).toHaveBeenCalledWith('augmented');
    expect(screen.getByRole('button', { name: /Options · Aug support stays with the buffed player/ })).toBeInTheDocument();
  });

  it('disables Aug credit where the view does not depend on it', async () => {
    useApp.setState({ filters: { ...initialState().filters, perspective: 'enemy' } });
    render(<OptionsMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Options' }));
    expect(screen.getByRole('checkbox', { name: /Credit Aug support to the Evoker/ })).toBeDisabled();
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
});
