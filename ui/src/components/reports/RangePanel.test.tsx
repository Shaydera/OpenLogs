import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { overviewFixture } from '../../test/overviewFixture';
import { RangePanel } from './RangePanel';
import { rangeLabel } from './rangeGeometry';

vi.mock('../../api/client', () => ({ api: {} }));

const setRange = vi.fn(async () => {});

beforeEach(() => {
  useApp.setState({ ...initialState(), setRange });
  setRange.mockClear();
});
afterEach(() => localStorage.clear());

const renderPanel = () => render(<RangePanel overview={overviewFixture} rangeKey="3180:15" />);

describe('RangePanel', () => {
  it('applies a phase pill, numbering repeated phase names, and the full fight', async () => {
    const [p1, , p2] = overviewFixture.timeline.phases;
    const submerged = { kind: 'intermission' as const, name: 'Boss submerged' };
    const phases = [
      { ...p1, startMs: 0, endMs: 100_000 },
      { ...submerged, number: 1, startMs: 100_000, endMs: 200_000 },
      { ...p2, startMs: 200_000, endMs: 300_000 },
      { ...submerged, number: 2, startMs: 300_000, endMs: 478_610 },
    ];
    render(<RangePanel overview={{ ...overviewFixture, timeline: { ...overviewFixture.timeline, phases } }} rangeKey="3180:15" />);
    await userEvent.click(screen.getByRole('button', { name: 'Boss submerged 2' }));
    expect(setRange).toHaveBeenLastCalledWith({ startMs: 300_000, endMs: 478_610 });
    act(() => useApp.setState({ range: { startMs: 300_000, endMs: 478_610 } }));
    expect(screen.getByRole('button', { name: 'Boss submerged 2' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Full fight' }));
    expect(setRange).toHaveBeenLastCalledWith(null);
  });

  it('collapsed shows the current span and expands on click', async () => {
    const intermission = { startMs: 120_000, endMs: 240_000 };
    useApp.setState({ range: intermission });
    const onToggle = vi.fn();
    render(<RangePanel overview={overviewFixture} rangeKey="3180:15" collapsible={{ open: false, onToggle }} />);
    const expand = screen.getByRole('button', { expanded: false });
    expect(expand).toHaveTextContent(rangeLabel(intermission));
    await userEvent.click(expand);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('saves the selected range under a name, then applies and deletes it', async () => {
    useApp.setState({ range: { startMs: 158_000, endMs: 273_000 } });
    const { unmount } = renderPanel();
    const open = screen.getByRole('button', { name: '+ Save range' });
    await userEvent.click(open);
    const form = screen.getByRole('form', { name: 'Save the selected range' });
    const name = within(form).getByRole('textbox', { name: 'Range name' });
    expect(name).toHaveFocus();
    const save = within(form).getByRole('button', { name: 'Save' });
    await userEvent.type(name, '   ');
    expect(save).toBeDisabled();
    await userEvent.type(name, 'Burn  ');
    await userEvent.click(save);
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(open).toHaveFocus();
    unmount();

    useApp.setState({ range: null });
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Burn' }));
    expect(setRange).toHaveBeenLastCalledWith({ startMs: 158_000, endMs: 273_000 });
    await userEvent.click(screen.getByRole('button', { name: 'Delete saved range Burn' }));
    expect(screen.queryByRole('button', { name: 'Burn' })).not.toBeInTheDocument();
  });

  it('fits ranges saved on a longer pull of the boss into this one', async () => {
    localStorage.setItem(
      'openlogs.ranges.3180:15',
      JSON.stringify([
        { name: 'Late', startMs: 400_000, endMs: 600_000 },
        { name: 'Beyond', startMs: 500_000, endMs: 700_000 },
      ]),
    );
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Late' }));
    expect(setRange).toHaveBeenLastCalledWith({ startMs: 400_000, endMs: 478_610 });
    expect(screen.getByRole('button', { name: 'Beyond' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete saved range Beyond' })).toBeEnabled();
  });

  it('closes the save form with Escape, Cancel or when focus leaves it, but not on a click inside it', async () => {
    useApp.setState({ range: { startMs: 158_000, endMs: 273_000 } });
    renderPanel();
    const open = screen.getByRole('button', { name: '+ Save range' });
    await userEvent.click(open);
    await userEvent.click(within(screen.getByRole('form')).getByText('Range name'));
    expect(screen.getByRole('form')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(open).toHaveFocus();
    await userEvent.click(open);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    await userEvent.click(open);
    await userEvent.click(screen.getByRole('button', { name: 'Phase 1' }));
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });

  it("pans the timeline's window when its band is dragged and keeps the range", () => {
    useApp.setState({ tab: 'casts', reportView: 'timeline', zoom: { startMs: 120_000, endMs: 140_000 } });
    renderPanel();
    vi.spyOn(screen.getByTestId('range-plot'), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 478.61, 64));
    fireEvent.mouseDown(screen.getByTestId('range-zoom'), { button: 0, clientX: 120 });
    fireEvent.mouseMove(document, { clientX: 130 });
    fireEvent.mouseUp(document, { clientX: 130 });
    expect(useApp.getState().zoom).toEqual({ startMs: 130_000, endMs: 150_000 });
    expect(setRange).not.toHaveBeenCalled();
  });
});
