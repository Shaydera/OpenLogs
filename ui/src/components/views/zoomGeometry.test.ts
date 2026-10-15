import { describe, expect, it } from 'vitest';
import { clampWindow, dragWindow, panBy, presetWindow, presets, requestWindow, rulerTicks, shownWindow, wheelPanFraction, wheelZoomFactor, zoomBy } from './zoomGeometry';

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

  it('steps the ruler so labels stay apart, with minor ticks between them', () => {
    const ticks = rulerTicks(window, 1_000);
    expect(ticks.stepMs).toBe(2_000);
    expect(ticks.major.slice(0, 3)).toEqual([120_000, 122_000, 124_000]);
    expect(ticks.minor.slice(0, 2)).toEqual([120_400, 120_800]);
    expect(rulerTicks({ startMs: 0, endMs: 300_000 }, 1_000).stepMs).toBe(30_000);
  });
});
