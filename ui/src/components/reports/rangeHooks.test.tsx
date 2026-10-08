import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TimeRange } from '../../store';
import { useBrush } from './useBrush';
import { useRangeKeys } from './useRangeKeys';

const DURATION = 100_000;
const BOX = { left: 100, width: 1000, top: 0, height: 40, right: 1100, bottom: 40, x: 100, y: 0, toJSON: () => ({}) };

/** A plot with two handles, wired like the Timeline and the RangePanel. */
function Harness({
  current,
  onChange,
  onClick,
}: {
  current: TimeRange | null;
  onChange: (range: TimeRange | null) => void;
  onClick: (x: number, width: number) => void;
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const brush = useBrush(plotRef, DURATION, current, onChange, onClick);
  const keys = useRangeKeys(DURATION, current, onChange, 'hint');
  const shown = keys.draft !== undefined ? keys.draft : brush.preview !== undefined ? brush.preview : current;
  return (
    <div ref={plotRef} data-testid="plot" onMouseDown={(event) => brush.start(event, 'brush')}>
      <output>{shown ? `${shown.startMs}–${shown.endMs}` : 'full'}</output>
      <span {...keys.handleProps('start', shown)} onMouseDown={(event) => brush.start(event, 'start')} />
      <span {...keys.handleProps('end', shown)} onMouseDown={(event) => brush.start(event, 'end')} />
    </div>
  );
}

function setup(current: TimeRange | null = null) {
  const onChange = vi.fn();
  const onClick = vi.fn();
  render(<Harness current={current} onChange={onChange} onClick={onClick} />);
  vi.spyOn(screen.getByTestId('plot'), 'getBoundingClientRect').mockReturnValue(BOX);
  return { onChange, onClick };
}

const shown = () => screen.getByRole('status').textContent;

afterEach(() => vi.restoreAllMocks());

describe('useBrush', () => {
  it('selects a dragged range in whole seconds and previews it while dragging', () => {
    const { onChange, onClick } = setup();
    fireEvent.mouseDown(screen.getByTestId('plot'), { clientX: 400, button: 0 });
    fireEvent.mouseMove(document, { clientX: 702, buttons: 1 });
    expect(shown()).toBe('30000–60000');
    fireEvent.mouseUp(document, { clientX: 702 });
    expect(onChange).toHaveBeenCalledWith({ startMs: 30_000, endMs: 60_000 });
    expect(onClick).not.toHaveBeenCalled();
    expect(shown()).toBe('full');
  });

  it('reports a click without a drag and moves one edge when its handle is dragged', () => {
    const { onChange, onClick } = setup();
    fireEvent.mouseDown(screen.getByTestId('plot'), { clientX: 400, button: 0 });
    fireEvent.mouseUp(document, { clientX: 402 });
    expect(onClick).toHaveBeenCalledWith(300, 1000);
    expect(onChange).not.toHaveBeenCalled();

    const [start] = screen.getAllByRole('slider');
    fireEvent.mouseDown(start, { clientX: 100, button: 0 });
    fireEvent.mouseUp(document, { clientX: 351 });
    expect(onChange).toHaveBeenCalledWith({ startMs: 25_000, endMs: 100_000 });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('useRangeKeys', () => {
  it('follows held keys and commits once on release', () => {
    const { onChange } = setup();
    const [, end] = screen.getAllByRole('slider');
    // A handled key does not scroll the page.
    expect(fireEvent.keyDown(end, { key: 'ArrowLeft' })).toBe(false);
    fireEvent.keyDown(end, { key: 'ArrowLeft' });
    fireEvent.keyDown(end, { key: 'PageDown' });
    expect(shown()).toBe('0–88000');
    expect(end).toHaveAttribute('aria-valuetext', '1:28');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyUp(end, { key: 'PageDown' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ startMs: 0, endMs: 88_000 });
  });

  it('moves the whole selection with Shift, commits on blur and selects the full pull with Escape at once', () => {
    const { onChange } = setup({ startMs: 30_000, endMs: 60_000 });
    const [start] = screen.getAllByRole('slider');
    fireEvent.keyDown(start, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(start, { key: 'PageUp', shiftKey: true });
    fireEvent.blur(start);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ startMs: 41_000, endMs: 71_000 });
    fireEvent.keyDown(start, { key: 'Escape' });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
