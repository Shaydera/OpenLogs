import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n/i18n';
import { initialState, useApp } from '../../store';
import { overviewFixture } from '../../test/overviewFixture';
import { replayFixture } from '../../test/replayFixture';
import { ReplayTab } from './ReplayTab';

vi.mock('../../api/client', () => ({ api: {} }));

const replay = () => useApp.getState().replay;

beforeEach(() => {
  useApp.setState({ ...initialState(), tab: 'replay', replayData: replayFixture });
});

afterEach(() => vi.restoreAllMocks());

describe('ReplayTab', () => {
  it('space toggles play and arrows jump five seconds', async () => {
    useApp.setState({ replay: { ...initialState().replay, time: 60_000 } });
    render(<ReplayTab />);
    screen.getByRole('region', { name: 'Replay' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(replay().time).toBe(65_000);
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(replay().time).toBe(55_000);
    await userEvent.keyboard(' ');
    expect(replay().playing).toBe(true);
    await userEvent.keyboard(' ');
    expect(replay().playing).toBe(false);
  });

  it('arrow keys and space in the meter category stay with the menu', async () => {
    useApp.setState({ replay: { ...initialState().replay, time: 60_000 } });
    render(<ReplayTab />);
    screen.getByRole('combobox', { name: t('replay.meterCategory') }).focus();
    await userEvent.keyboard('{ArrowRight}{ArrowLeft} ');
    expect(replay()).toMatchObject({ time: 60_000, playing: false });
  });

  it('a held space toggles play only once', () => {
    render(<ReplayTab />);
    const region = screen.getByRole('region', { name: 'Replay' });
    fireEvent.keyDown(region, { key: ' ' });
    fireEvent.keyDown(region, { key: ' ', repeat: true });
    expect(replay().playing).toBe(true);
    fireEvent.keyDown(region, { key: ' ' });
    expect(replay().playing).toBe(false);
  });

  describe('timeline', () => {
    beforeEach(() => {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1_000, 26));
      Object.defineProperty(Element.prototype, 'setPointerCapture', { value: () => {}, configurable: true });
    });
    afterEach(() => {
      vi.restoreAllMocks();
      delete (Element.prototype as Partial<Element>).setPointerCapture;
    });

    it('clicking the timeline seeks', async () => {
      useApp.setState({ range: { startMs: 60_000, endMs: 180_000 } });
      render(<ReplayTab />);
      await userEvent.pointer({ keys: '[MouseLeft]', target: screen.getByRole('slider', { name: 'Timeline' }), coords: { clientX: 500, clientY: 13 } });
      expect(replay().time).toBe(120_000);
    });

    it('dragging and the wheel on the timeline seek', () => {
      render(<ReplayTab />);
      const timeline = screen.getByRole('slider', { name: 'Timeline' });
      fireEvent.pointerDown(timeline, { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: 100 });
      fireEvent.pointerMove(timeline, { pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: 250 });
      fireEvent.pointerUp(timeline, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 250 });
      expect(replay().time).toBe(75_000);
      fireEvent.pointerMove(timeline, { pointerId: 1, pointerType: 'mouse', buttons: 0, clientX: 900 });
      expect(replay().time).toBe(75_000);
      expect(fireEvent.wheel(timeline, { deltaY: 100 })).toBe(false);
      expect(replay().time).toBe(76_000);
      useApp.getState().setReplayTime(0);
      expect(fireEvent.wheel(timeline, { deltaY: -100 })).toBe(true);
    });

    it('scrubber shades after the cut and End seeks to it', () => {
      const overview = { ...overviewFixture, timeline: { ...overviewFixture.timeline, cutoffMs: 130_320 } };
      const seek = vi.fn();
      useApp.setState({ overview, deathCutoff: 3, setReplayTime: seek, replay: { ...initialState().replay, time: 130_321 } });
      render(<ReplayTab />);
      const timeline = screen.getByRole('slider', { name: 'Timeline' });
      expect(within(timeline).getByText('not analysed · 2:49')).toBeInTheDocument();
      fireEvent.keyDown(timeline, { key: 'End' });
      expect(seek).toHaveBeenLastCalledWith(130_321);
      // At the cut the wheel scrolls the page again.
      expect(fireEvent.wheel(timeline, { deltaY: 100 })).toBe(true);
    });
  });

  it('leaving the replay pauses it unless the split keeps it on screen', () => {
    const alone = render(<ReplayTab />);
    useApp.getState().toggleReplayPlay();
    alone.unmount();
    expect(replay().playing).toBe(false);

    useApp.setState({ replay: { ...replay(), split: true } });
    const beside = render(<ReplayTab />);
    useApp.getState().toggleReplayPlay();
    beside.unmount();
    expect(replay().playing).toBe(true);
    useApp.getState().toggleReplayPlay();
  });

  it('the compact pane starts the meter and the unit frame collapsed and expands on click', async () => {
    useApp.setState({ replay: { ...initialState().replay, selected: 1 } });
    render(<ReplayTab compact />);
    const caption = screen.getByRole('button', { name: t('replay.unitFrames') });
    expect(caption).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: t('replay.meter') })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'Talwyn' })).toBeNull();
    await userEvent.click(caption);
    expect(screen.getByRole('group', { name: 'Talwyn' })).toBeInTheDocument();
  });

  it('a short stage starts the raid frames collapsed and they still expand', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ width: 1500, height: 400 }));
    render(<ReplayTab />);
    const caption = screen.getByRole('button', { name: t('replay.raidFrames') });
    expect(caption).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: t('replay.meter') })).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(caption);
    expect(caption).toHaveAttribute('aria-expanded', 'true');
  });

  it('turns the HUD dense while the measured stage is shorter than 800 px and keeps the open panels open', () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ width: 1500, height: 900 }));
    const resized: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resized.push(callback);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    try {
      render(<ReplayTab />);
      const region = screen.getByRole('region', { name: 'Replay' });
      expect(region).not.toHaveAttribute('data-dense');

      const short = DOMRect.fromRect({ width: 1500, height: 700 });
      rect.mockReturnValue(short);
      act(() => resized.forEach((callback) => callback([{ contentRect: short } as ResizeObserverEntry], {} as ResizeObserver)));
      expect(region).toHaveAttribute('data-dense');
      expect(screen.getByRole('button', { name: t('replay.raidFrames') })).toHaveAttribute('aria-expanded', 'true');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the wheel scrolls an overflowing legend sideways', () => {
    render(<ReplayTab />);
    const legend = screen.getByRole('group', { name: 'Legend' });
    Object.defineProperties(legend, { scrollWidth: { value: 900 }, clientWidth: { value: 300 } });
    expect(fireEvent.wheel(legend, { deltaY: 120 })).toBe(false);
    expect(legend.scrollLeft).toBe(120);
  });

  it('shows a notice without advanced logging', () => {
    useApp.setState({ replayData: { ...replayFixture, advancedLogging: false } });
    render(<ReplayTab />);
    expect(screen.getByRole('heading', { name: 'No positions in this log' })).toBeInTheDocument();
    expect(screen.queryByRole('application', { name: 'Replay stage' })).toBeNull();
  });

  it('legend click hides a unit', async () => {
    render(<ReplayTab />);
    await userEvent.click(within(screen.getByRole('group', { name: 'Legend' })).getByRole('button', { name: 'Orsek' }));
    expect(replay().filters.hidden).toContain(3);
  });
});
