import { describe, expect, it } from 'vitest';
import { effectLabelAt } from './stageDraw';

describe('effect labels', () => {
  it('sit above their circle', () => {
    expect(effectLabelAt(300, 300, 100, 80, 640, 480)).toEqual([300, 194]);
  });

  it('stay on the stage when the circle reaches its edges', () => {
    const [x, bottom] = effectLabelAt(20, 60, 200, 80, 640, 480);
    expect(x - 40).toBeGreaterThanOrEqual(0);
    expect(bottom - 12).toBeGreaterThanOrEqual(0);
  });
});
