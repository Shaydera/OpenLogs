import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { overviewFixture } from '../../test/overviewFixture';
import { Timeline } from './Timeline';

vi.mock('../../api/client', () => ({ api: {} }));

const setRange = vi.fn(async () => {});
const BOX = { left: 100, width: 1000, top: 0, height: 130, right: 1100, bottom: 130, x: 100, y: 0, toJSON: () => ({}) };

beforeEach(() => {
  useApp.setState({ ...initialState(), setRange });
  setRange.mockClear();
});
afterEach(() => vi.restoreAllMocks());

/** The plot, 1000px wide from x = 100. */
function plot() {
  const element = screen.getByTestId('timeline-plot');
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(BOX);
  return element;
}

function click(element: HTMLElement, clientX: number) {
  fireEvent.mouseDown(element, { clientX, button: 0 });
  fireEvent.mouseUp(document, { clientX });
}

describe('Timeline', () => {
  it('marks deaths and Bloodlust and names the selected phase', () => {
    render(<Timeline overview={overviewFixture} />);
    expect(screen.getByRole('img', { name: 'Death: Wendel at 0:33' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Death: Faelan at 3:59' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Bloodlust: Time Warp by Faelan at 0:02' })).toBeInTheDocument();
    expect(screen.getByText(/\(full fight\)/)).toBeInTheDocument();
    act(() => useApp.setState({ range: { startMs: 240_000, endMs: 478_610 } }));
    expect(screen.getByText(/\(Phase 2\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Phase 2' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('selects a range by dragging, the phase under a click, and the full fight on a second click', () => {
    render(<Timeline overview={overviewFixture} />);
    const element = plot();
    fireEvent.mouseDown(element, { clientX: 430, button: 0 });
    fireEvent.mouseMove(document, { clientX: 670, buttons: 1 });
    fireEvent.mouseUp(document, { clientX: 670 });
    expect(setRange).toHaveBeenLastCalledWith({ startMs: 158_000, endMs: 273_000 });

    click(element, 400);
    expect(setRange).toHaveBeenLastCalledWith({ startMs: 120_000, endMs: 240_000 });
    act(() => useApp.setState({ range: { startMs: 120_000, endMs: 240_000 } }));
    click(element, 400);
    expect(setRange).toHaveBeenLastCalledWith(null);
  });
});
