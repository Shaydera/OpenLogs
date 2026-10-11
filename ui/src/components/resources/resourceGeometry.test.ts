import { describe, expect, it } from 'vitest';
import { resourcePaths } from './resourceGeometry';

describe('resourcePaths', () => {
  it('breaks at unknown steps and draws a lone sample as a short dash without area', () => {
    const { line, area } = resourcePaths([25, 100, null, 40], 5_000, 0, 20_000);
    expect(line).toBe('M 125 116 L 375 8 M 870 94.4 L 880 94.4');
    expect(area).toBe('M 125 116 L 375 8 L 375 160 L 125 160 Z');
  });

  it('breaks the line where the player was dead', () => {
    const { line, area } = resourcePaths([50, 100, 80, 40], 5_000, 0, 20_000, [[5_000, 15_000]]);
    expect(line).toBe('M 120 80 L 130 80 M 870 94.4 L 880 94.4');
    expect(area).toBe('');
  });
});
