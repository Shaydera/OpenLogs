import { describe, expect, it } from 'vitest';
import {
  clampWindow,
  dragWindow,
  grabWindow,
  panBy,
  pinchWindow,
  presetWindow,
  presets,
  pressGesture,
  requestWindow,
  rulerTicks,
  shownWindow,
  timeAtX,
  wheelPanFraction,
  wheelWindow,
  wheelZoomFactor,
  windowSpan,
  zoomBy,
} from './zoomGeometry';

const pull = { startMs: 0, endMs: 478_610 };

describe('the timeline window', () => {
  it('starts with the first 20 s of the range, or all of a shorter range', () => {
    expect(shownWindow(null, { startMs: 120_000, endMs: 300_000 })).toEqual({ startMs: 120_000, endMs: 140_000 });
    expect(shownWindow(null, { startMs: 120_000, endMs: 130_000 })).toEqual({ startMs: 120_000, endMs: 130_000 });
  });

  it('stays inside the range, keeps its length and never gets narrower than 2.5 s', () => {
    expect(clampWindow({ startMs: 470_000, endMs: 490_000 }, pull)).toEqual({ startMs: 458_610, endMs: 478_610 });
    expect(clampWindow({ startMs: 10_000, endMs: 10_500 }, pull)).toEqual({ startMs: 10_000, endMs: 12_500 });
  });

  it('asks for half a window more on either side, cut at the range', () => {
    expect(requestWindow({ startMs: 120_000, endMs: 140_000 }, pull)).toEqual({ startMs: 110_000, endMs: 150_000 });
    expect(requestWindow({ startMs: 0, endMs: 20_000 }, pull)).toEqual({ startMs: 0, endMs: 30_000 });
  });
});

describe('zooming and panning', () => {
  const window = { startMs: 120_000, endMs: 140_000 };

  it('offers the long lengths only where the range holds them', () => {
    expect(presets(pull)).toEqual([5_000, 10_000, 20_000, 30_000, 60_000, 120_000, 300_000, null]);
    expect(presets({ startMs: 0, endMs: 90_000 })).toEqual([5_000, 10_000, 20_000, 30_000, 60_000, null]);
    expect(presetWindow(window, 10_000, pull)).toEqual({ startMs: 125_000, endMs: 135_000 });
  });

  it('zooms around the pointer, which stays where it is', () => {
    expect(zoomBy(window, 0.5, 125_000, pull)).toEqual({ startMs: 122_500, endMs: 132_500 });
    expect(zoomBy(window, 2, 130_000, pull)).toEqual({ startMs: 110_000, endMs: 150_000 });
  });

  it('pans by half a window and stops at the range', () => {
    expect(panBy(window, 0.5, pull)).toEqual({ startMs: 130_000, endMs: 150_000 });
    expect(panBy({ startMs: 5_000, endMs: 25_000 }, -0.5, pull)).toEqual({ startMs: 0, endMs: 20_000 });
  });

  it('turns a drag across the ruler into its span and a click into nothing', () => {
    expect(dragWindow(250, 750, 1_000, window, pull)).toEqual({ startMs: 125_000, endMs: 135_000 });
    expect(dragWindow(500, 502, 1_000, window, pull)).toBeNull();
    expect(dragWindow(500, 510, 1_000, window, pull)).toEqual({ startMs: 128_850, endMs: 131_350 });
  });

  it('zooms and pans a wheel turn by how far it turned', () => {
    expect(wheelZoomFactor(100)).toBeGreaterThan(1.2);
    expect(wheelZoomFactor(-4)).toBeGreaterThan(0.99);
    expect(wheelZoomFactor(-4)).toBeLessThan(1);
    expect(wheelPanFraction(100)).toBe(0.1);
    expect(wheelPanFraction(-3_000)).toBe(-0.5);
  });

  it('tells a click from a drag, and a touch that scrolls the page from one that drags', () => {
    expect(pressGesture(2, 2, false)).toBe('click');
    expect(pressGesture(0, 12, false)).toBe('drag');
    expect(pressGesture(3, 12, true)).toBe('scroll');
    expect(pressGesture(-12, 3, true)).toBe('drag');
  });

  it('moves the window with a grabbed track, the content under the pointer, and stops at the range', () => {
    expect(grabWindow(window, 100, 1_000, pull)).toEqual({ startMs: 118_000, endMs: 138_000 });
    expect(grabWindow(window, -250, 1_000, pull)).toEqual({ startMs: 125_000, endMs: 145_000 });
    expect(grabWindow({ startMs: 5_000, endMs: 25_000 }, 600, 1_000, pull)).toEqual({ startMs: 0, endMs: 20_000 });
    expect(grabWindow({ startMs: 460_000, endMs: 478_610 }, -600, 1_000, pull)).toEqual({ startMs: 460_000, endMs: 478_610 });
  });

  it('pinches around the fingers: the time between them follows their midpoint', () => {
    expect(pinchWindow(window, [400, 600], [300, 700], 1_000, pull)).toEqual({ startMs: 125_000, endMs: 135_000 });
    expect(pinchWindow(window, [400, 600], [450, 550], 1_000, pull)).toEqual({ startMs: 110_000, endMs: 150_000 });
    expect(pinchWindow(window, [400, 600], [500, 700], 1_000, pull)).toEqual({ startMs: 118_000, endMs: 138_000 });
    expect(windowSpan(pinchWindow(window, [500, 500], [200, 800], 1_000, pull))).toBe(2_500);
  });

  it('zooms a wheel turn around the pointer and pans a sideways or Shift + wheel turn', () => {
    const turn = { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, shiftKey: false };
    const zoomedIn = wheelWindow({ ...turn, deltaY: -100 }, 250, 1_000, window, pull);
    expect(windowSpan(zoomedIn!)).toBeLessThan(20_000);
    expect(timeAtX(250, 1_000, zoomedIn!)).toBeCloseTo(125_000, -1);
    expect(windowSpan(wheelWindow({ ...turn, deltaY: 3 }, 250, 1_000, window, pull)!)).toBeGreaterThan(20_000);
    expect(wheelWindow({ ...turn, deltaY: -100, ctrlKey: true }, 250, 1_000, window, pull)).toEqual(zoomedIn);
    expect(wheelWindow({ ...turn, deltaX: 100, deltaY: 10 }, 250, 1_000, window, pull)).toEqual({ startMs: 122_000, endMs: 142_000 });
    expect(wheelWindow({ ...turn, deltaY: 100, shiftKey: true }, 250, 1_000, window, pull)).toEqual({ startMs: 122_000, endMs: 142_000 });
    expect(wheelWindow({ ...turn, deltaY: -3, deltaMode: 1, shiftKey: true }, 250, 1_000, window, pull)).toEqual({ startMs: 119_040, endMs: 139_040 });
    expect(wheelWindow(turn, 250, 1_000, window, pull)).toBeNull();
  });

  it('steps the ruler so labels stay apart, with minor ticks between them', () => {
    const ticks = rulerTicks(window, 1_000);
    expect(ticks.stepMs).toBe(2_000);
    expect(ticks.major.slice(0, 3)).toEqual([120_000, 122_000, 124_000]);
    expect(ticks.minor.slice(0, 2)).toEqual([120_400, 120_800]);
    expect(rulerTicks({ startMs: 0, endMs: 300_000 }, 1_000).stepMs).toBe(30_000);
  });
});
