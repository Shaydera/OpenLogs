import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { ReportToolbar } from './ReportToolbar';

vi.mock('../../api/client', () => ({ api: {} }));

beforeEach(() => {
  localStorage.clear();
  useApp.setState({ ...initialState(), filterOptions: vi.fn(async () => []) });
});

describe('report toolbar', () => {
  it('puts View as, the source and the report tools in one row', () => {
    useApp.setState({ tab: 'damage' });
    render(<ReportToolbar />);
    const toolbar = screen.getByRole('toolbar');
    expect(toolbar).toContainElement(screen.getByRole('group', { name: 'Whose view' }));
    expect(toolbar).toContainElement(screen.getByRole('button', { name: /Source.*All/ }));
    expect(toolbar).toContainElement(screen.getByRole('button', { name: 'Options' }));
    expect(toolbar).toContainElement(screen.getByRole('group', { name: 'View' }));
    expect(toolbar).toContainElement(screen.getByRole('button', { name: 'Replay alongside' }));
  });

  it('renders nothing on the replay', () => {
    useApp.setState({ tab: 'replay' });
    render(<ReportToolbar />);
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('keeps the tools but drops View as while a detail is open', () => {
    useApp.setState({ tab: 'damage', details: [{ kind: 'player', unit: { id: 'p', name: 'P' } } as never] });
    render(<ReportToolbar />);
    expect(screen.queryByRole('group', { name: 'Whose view' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Options' })).toBeInTheDocument();
  });

  it('offers Hide procs in the Options menu on Casts and remembers the choice', async () => {
    useApp.setState({ tab: 'casts', hideProcs: true });
    render(<ReportToolbar />);
    await userEvent.click(screen.getByRole('button', { name: 'Options' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Hide procs' }));
    expect(useApp.getState().hideProcs).toBe(false);
    expect(localStorage.getItem('openlogs.hideProcs')).toBe('false');
  });

  it.each(['overview', 'casts'] as const)('keeps Aug credit unavailable on %s, which it does not affect', async (tab) => {
    useApp.setState({ tab });
    render(<ReportToolbar />);
    await userEvent.click(screen.getByRole('button', { name: 'Options' }));
    expect(screen.getByRole('checkbox', { name: /Credit Aug support to the Evoker/ })).toBeDisabled();
  });
});
