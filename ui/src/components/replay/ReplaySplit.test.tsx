import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { recapFixture } from '../../test/reportFixtures';
import { replayFixture } from '../../test/replayFixture';
import { DeathsTab } from '../deaths/DeathsTab';
import { ReplaySplit } from './ReplaySplit';

vi.mock('../../api/client', () => ({ api: {} }));

const death = recapFixture.deaths[0];
const replay = () => useApp.getState().replay;

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'setPointerCapture', { value: () => {}, configurable: true });
  localStorage.clear();
  useApp.setState({ ...initialState(), tab: 'deaths', replayData: replayFixture, filterOptions: vi.fn(async () => []) });
});

afterEach(() => {
  delete (Element.prototype as Partial<Element>).setPointerCapture;
});

describe('ReplaySplit', () => {
  it('a death click in the split seeks five seconds before the death', async () => {
    useApp.setState({ replay: { ...initialState().replay, split: true } });
    render(
      <ReplaySplit>
        <DeathsTab report={recapFixture} />
      </ReplaySplit>,
    );
    await userEvent.click(screen.getByRole('button', { name: /^3:59/ }));
    expect(replay().time).toBe(death.t - 5_000);
    expect(useApp.getState().tab).toBe('deaths');
    expect(screen.getByRole('region', { name: 'Replay' })).toBeInTheDocument();
  });

  it('outside the split show in replay opens the replay tab at the time', async () => {
    render(<DeathsTab report={recapFixture} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show in replay' }));
    expect(useApp.getState().tab).toBe('replay');
    expect(replay().time).toBe(death.t - 5_000);
  });

  it('the divider moves with the keyboard and remembers its width', async () => {
    useApp.setState({ replay: { ...initialState().replay, split: true } });
    render(
      <ReplaySplit>
        <p>Report</p>
      </ReplaySplit>,
    );
    const divider = screen.getByRole('separator', { name: 'Resize the replay' });
    const before = replay().splitWidth;
    divider.focus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    const wider = replay().splitWidth;
    expect(wider).toBeGreaterThan(before);
    await userEvent.keyboard('{ArrowRight}');
    expect(replay().splitWidth).toBeLessThan(wider);
    expect(replay().splitWidth).toBeGreaterThan(before);
    expect(initialState().replay.splitWidth).toBe(replay().splitWidth);
  });

  it('a drag on the divider resizes the replay and keeps it at its minimum width', () => {
    useApp.setState({ replay: { ...initialState().replay, split: true } });
    render(
      <ReplaySplit>
        <p>Report</p>
      </ReplaySplit>,
    );
    const divider = screen.getByRole('separator', { name: 'Resize the replay' });
    const drag = (from: number, to: number) => {
      fireEvent.pointerDown(divider, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: from });
      fireEvent.pointerMove(divider, { pointerId: 1, pointerType: 'mouse', clientX: to });
      fireEvent.pointerUp(divider, { pointerId: 1, pointerType: 'mouse', clientX: to });
    };
    drag(500, 400);
    expect(replay().splitWidth).toBe(580);
    drag(400, 900);
    expect(replay().splitWidth).toBe(420);
  });
});
