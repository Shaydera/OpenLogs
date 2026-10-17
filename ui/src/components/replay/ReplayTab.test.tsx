import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n/i18n';
import { initialState, useApp } from '../../store';
import { replayFixture } from '../../test/replayFixture';
import { ReplayTab } from './ReplayTab';

vi.mock('../../api/client', () => ({ api: {} }));

const replay = () => useApp.getState().replay;

beforeEach(() => {
  useApp.setState({ ...initialState(), tab: 'replay', replayData: replayFixture });
});

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

  it('the compact pane starts the unit frame collapsed and expands it on click', async () => {
    useApp.setState({ replay: { ...initialState().replay, selected: 1 } });
    render(<ReplayTab compact />);
    const caption = screen.getByRole('button', { name: t('replay.unitFrame') });
    expect(caption).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'Talwyn' })).toBeNull();
    await userEvent.click(caption);
    expect(screen.getByRole('group', { name: 'Talwyn' })).toBeInTheDocument();
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
