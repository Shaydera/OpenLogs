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

  it('keeps the tabs a set has not focusable but inert, with the reason', async () => {
    const setTab = vi.fn(async () => {});
    useApp.setState({ view: { kind: 'set', set: { kind: 'all', encounterId: 3492, difficulty: 15, fights: [1, 3] } }, tab: 'interrupts', setTab });
    render(<TabBar />);
    for (const name of ['Resources', 'Replay']) {
      const tab = screen.getByRole('tab', { name });
      expect(tab).toHaveAttribute('aria-disabled', 'true');
      expect(tab).toHaveAccessibleDescription('Needs a single pull');
      await userEvent.click(tab);
      expect(tab).toHaveFocus();
    }
    expect(setTab).not.toHaveBeenCalled();

    screen.getByRole('tab', { name: 'Interrupts & Dispels' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Resources' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Replay' })).toHaveFocus();
    expect(setTab).not.toHaveBeenCalled();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();
    expect(setTab).toHaveBeenCalledWith('overview');
  });
});
