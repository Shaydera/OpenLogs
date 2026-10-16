import { describe, expect, it } from 'vitest';
import { MAX_SCALE, MIN_SCALE, facingOnScreen, fitCamera, gridStep, pinchCamera, toScreen, toWorld, zoomAt } from './camera';

const W = 640;
const H = 480;

describe('the stage camera', () => {
  it('shows north (world x) up and west (world y) left', () => {
    const cam = { cx: 388, cy: 410, scale: 5 };
    const [cx, cy] = toScreen(cam, 388, 410, W, H);
    const [nx, ny] = toScreen(cam, 389, 410, W, H);
    const [wx, wy] = toScreen(cam, 388, 411, W, H);
    expect([nx - cx, ny - cy]).toEqual([0, -5]);
    expect([wx - cx, wy - cy]).toEqual([-5, 0]);
    const [sx, sy] = toScreen(cam, 347.14, 420.35, W, H);
    expect(sy).toBeGreaterThan(cy);
    expect(sx).toBeLessThan(cx);
    expect(sy - cy).toBeGreaterThan(cx - sx);
  });

  it('points facing 0 up and a quarter turn left', () => {
    const [ux, uy] = facingOnScreen(0);
    const [lx, ly] = facingOnScreen(Math.PI / 2);
    expect(ux).toBeCloseTo(0, 9);
    expect(uy).toBeCloseTo(-1, 9);
    expect(lx).toBeCloseTo(-1, 9);
    expect(ly).toBeCloseTo(0, 9);
  });

  it('fit contains all bounds with padding', () => {
    const bounds = { minX: 300, minY: 350, maxX: 460, maxY: 470 };
    const cam = fitCamera(bounds, W, H, 40);
    for (const [x, y] of [
      [bounds.minX, bounds.minY],
      [bounds.maxX, bounds.maxY],
      [bounds.minX, bounds.maxY],
      [bounds.maxX, bounds.minY],
    ]) {
      const [sx, sy] = toScreen(cam, x, y, W, H);
      expect(sx).toBeGreaterThanOrEqual(40 - 1e-9);
      expect(sx).toBeLessThanOrEqual(W - 40 + 1e-9);
      expect(sy).toBeGreaterThanOrEqual(40 - 1e-9);
      expect(sy).toBeLessThanOrEqual(H - 40 + 1e-9);
    }
  });

  it('zoom keeps the point under the cursor fixed', () => {
    const cam = { cx: 400, cy: 410, scale: 5 };
    const before = toWorld(cam, 120, 300, W, H);
    for (const factor of [1.5, 0.4, 1000]) {
      const zoomed = zoomAt(cam, factor, 120, 300, W, H);
      const [x, y] = toWorld(zoomed, 120, 300, W, H);
      expect(x).toBeCloseTo(before[0], 9);
      expect(y).toBeCloseTo(before[1], 9);
    }
  });

  it('a pinch zooms by the fingers’ spread and keeps the world point between them under their midpoint', () => {
    const cam = { cx: 400, cy: 410, scale: 5 };
    const between = toWorld(cam, 300, 200, W, H);
    const pinched = pinchCamera(cam, [{ x: 250, y: 200 }, { x: 350, y: 200 }], [{ x: 300, y: 250 }, { x: 500, y: 250 }], W, H);
    expect(pinched.scale).toBeCloseTo(10, 9);
    const [x, y] = toWorld(pinched, 400, 250, W, H);
    expect(x).toBeCloseTo(between[0], 9);
    expect(y).toBeCloseTo(between[1], 9);
  });

  it('toWorld inverts toScreen', () => {
    const cam = { cx: -1234.5, cy: 87.25, scale: 7.5 };
    const [sx, sy] = toScreen(cam, -1240, 95, W, H);
    const [x, y] = toWorld(cam, sx, sy, W, H);
    expect(x).toBeCloseTo(-1240, 9);
    expect(y).toBeCloseTo(95, 9);
  });

  it('grid step stays between 40 and 120 px', () => {
    const scales = [MAX_SCALE];
    for (let scale = MIN_SCALE; scale < MAX_SCALE; scale *= 1.07) scales.push(scale);
    for (const scale of scales) {
      const px = gridStep(scale) * scale;
      expect(px).toBeGreaterThanOrEqual(40);
      expect(px).toBeLessThanOrEqual(120);
    }
  });
});
