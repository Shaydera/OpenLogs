import { describe, expect, it } from 'vitest';
import { lowestIn, powerArea, powerPath, sampleAt, type Sample } from './powerLine';

const window = { startMs: 0, endMs: 10_000 };
const samples: Sample[] = [
  [-1_000, 900, 1_000],
  [2_000, 400, 1_000],
  [5_000, 1_000, 1_000],
  [12_000, 700, 1_000],
];

describe('power lines', () => {
  it('holds each value until the next sample and starts at the edge of the window', () => {
    expect(powerPath(samples, window)).toBe('M 0 5.6 H 200 L 200 23.6 H 500 L 500 2 H 1000');
  });

  it('fills the area under the held values down to the bottom of the box', () => {
    expect(powerArea(samples, window)).toBe('M 0 5.6 H 200 L 200 23.6 H 500 L 500 2 H 1000 V 40 H 0 Z');
    expect(powerArea([[12_000, 700, 1_000]], window)).toBe('');
  });

  it('breaks the line and its area where the unit was dead', () => {
    const dead: [number, number][] = [[3_000, 4_000]];
    expect(powerPath(samples, window, dead)).toBe('M 0 5.6 H 200 L 200 23.6 H 300 M 400 23.6 H 500 L 500 2 H 1000');
    expect(powerArea(samples, window, dead)).toBe('M 0 5.6 H 200 L 200 23.6 H 300 V 40 H 0 Z M 400 23.6 H 500 L 500 2 H 1000 V 40 H 400 Z');
  });

  it('reads the sample in force at a time and the lowest one in the window', () => {
    expect(sampleAt(samples, 3_000)).toEqual([2_000, 400, 1_000]);
    expect(sampleAt(samples, -2_000)).toBeNull();
    expect(lowestIn(samples, window)).toEqual([2_000, 400, 1_000]);
    expect(lowestIn([[-1_000, 100, 1_000], ...samples.slice(1)], window)).toEqual([-1_000, 100, 1_000]);
  });
});
