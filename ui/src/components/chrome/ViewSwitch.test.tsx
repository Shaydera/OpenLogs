import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { ViewSwitch } from './ViewSwitch';

vi.mock('../../api/client', () => ({ api: {} }));

const setReportView = vi.fn(async () => {});

beforeEach(() => {
  setReportView.mockClear();
  useApp.setState({ ...initialState(), tab: 'damage', setReportView });
});

describe('ViewSwitch', () => {
  it('switches the view of a report tab', async () => {
    render(<ViewSwitch />);
    await userEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(setReportView).toHaveBeenCalledWith('timeline');
  });

  it('tells keyboard and screen reader users why a view is unavailable and shows the table there', async () => {
    useApp.setState({ tab: 'resources', reportView: 'events' });
    render(<ViewSwitch />);
    const events = screen.getByRole('button', { name: 'Events' });
    expect(events).toHaveAttribute('aria-disabled', 'true');
    expect(events).toHaveAccessibleDescription('Resources has no events view');
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(events).toHaveFocus();
    await userEvent.click(events);
    expect(setReportView).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps detail pages on their own view', () => {
    useApp.setState({ reportView: 'timeline', details: [{ kind: 'player', player: 4 }] });
    render(<ViewSwitch />);
    expect(screen.getByRole('button', { name: 'Timeline' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
  });
});
