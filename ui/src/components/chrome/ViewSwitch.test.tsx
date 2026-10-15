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

  it('names why a view is unavailable and shows the table there', () => {
    useApp.setState({ tab: 'resources', reportView: 'events' });
    render(<ViewSwitch />);
    expect(screen.getByRole('button', { name: 'Events' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Events' })).toHaveAttribute('title', 'Resources has no events view');
    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps detail pages on their own view', () => {
    useApp.setState({ reportView: 'timeline', details: [{ kind: 'player', player: 4 }] });
    render(<ViewSwitch />);
    expect(screen.getByRole('button', { name: 'Timeline' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
  });
});
