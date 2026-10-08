import { describe, expect, it } from 'vitest';
import type { Phase } from '../../api/types';
import { overviewFixture } from '../../test/overviewFixture';
import { brushToRange, clickToRange, handleKey, phaseAt, rangeInPull, shiftRange, withEdge } from './rangeGeometry';

const D = 478_610;
/** Phase 1 0:00–2:00, Intermission 1 2:00–4:00, Phase 2 4:00–7:58. */
const PHASES: Phase[] = overviewFixture.timeline.phases;

describe('brushToRange', () => {
  it('maps a drag in either direction to whole seconds, clamped to the pull', () => {
    expect(brushToRange(330, 570, 1000, D)).toEqual({ startMs: 158_000, endMs: 273_000 });
    expect(brushToRange(570, 330, 1000, D)).toEqual({ startMs: 158_000, endMs: 273_000 });
    expect(brushToRange(-50, 1200, 1000, D)).toEqual({ startMs: 0, endMs: D });
  });

  it('makes no selection from a click or one shorter than a second, also at the end of the pull', () => {
    expect(brushToRange(500, 502, 1000, D)).toBeNull();
    expect(brushToRange(0, 5, 10_000, D)).toBeNull();
    // From the plot's last pixel past its right edge: 478 000 – 478 610 would be 0.61 s.
    expect(brushToRange(999, 1010, 1000, D)).toBeNull();
    expect(brushToRange(997, 1010, 1000, D)).toEqual({ startMs: 477_000, endMs: D });
    // A pull shorter than a second still allows its whole length.
    expect(brushToRange(-10, 1010, 1000, 600)).toEqual({ startMs: 0, endMs: 600 });
  });
});

describe('phases under the pointer', () => {
  it('finds the phase at a time: start included, the end in the next phase, the last one closed', () => {
    expect(phaseAt(PHASES, 0)).toBe(PHASES[0]);
    expect(phaseAt(PHASES, 120_000)).toBe(PHASES[1]);
    expect(phaseAt(PHASES, D)).toBe(PHASES[2]);
    expect(phaseAt(PHASES, D + 1)).toBeNull();
    expect(phaseAt([PHASES[0], PHASES[2]], 150_000)).toBeNull();
  });

  it('selects the clicked phase, and the full pull on the selected one or without a phase', () => {
    expect(clickToRange(300, 1000, D, PHASES, null)).toEqual({ startMs: 120_000, endMs: 240_000 });
    expect(clickToRange(300, 1000, D, PHASES, { startMs: 120_000, endMs: 240_000 })).toBeNull();
    expect(clickToRange(300, 1000, D, [PHASES[0], PHASES[2]], { startMs: 0, endMs: 120_000 })).toBeNull();
    expect(clickToRange(300, 1000, D, [{ kind: 'boss', number: 1, startMs: 0, endMs: D, name: null }], null)).toBeNull();
  });
});

describe('moving the selection', () => {
  it('moves one edge and keeps the edges a second apart inside the pull', () => {
    expect(withEdge(null, 'start', 60_000, D)).toEqual({ startMs: 60_000, endMs: D });
    expect(withEdge({ startMs: 60_000, endMs: 120_000 }, 'end', 50_000, D)).toEqual({ startMs: 60_000, endMs: 61_000 });
    expect(withEdge({ startMs: 60_000, endMs: 120_000 }, 'start', 130_000, D)).toEqual({ startMs: 119_000, endMs: 120_000 });
    expect(withEdge({ startMs: 0, endMs: 120_000 }, 'end', 900_000, D)).toBeNull();
    expect(withEdge(null, 'end', 100, 600)).toBeNull();
    expect(withEdge({ startMs: 0, endMs: 1 }, 'start', 500, 600)).toEqual({ startMs: 0, endMs: 1 });
  });

  it('moves the whole selection and stops at the ends of the pull', () => {
    expect(shiftRange({ startMs: 60_000, endMs: 120_000 }, -70_000, D)).toEqual({ startMs: 0, endMs: 60_000 });
    expect(shiftRange({ startMs: 400_000, endMs: 470_000 }, 10_000, D)).toEqual({ startMs: 408_610, endMs: D });
  });

  it('steps a handle with the slider keys', () => {
    const r = { startMs: 60_000, endMs: 120_000 };
    expect(handleKey(null, 'start', 'ArrowRight', false, D)).toEqual({ startMs: 1_000, endMs: D });
    expect(handleKey(r, 'end', 'ArrowUp', false, D)).toEqual({ startMs: 60_000, endMs: 121_000 });
    expect(handleKey(r, 'start', 'ArrowDown', false, D)).toEqual({ startMs: 59_000, endMs: 120_000 });
    expect(handleKey(r, 'end', 'PageUp', false, D)).toEqual({ startMs: 60_000, endMs: 130_000 });
    expect(handleKey(r, 'start', 'ArrowLeft', true, D)).toEqual({ startMs: 59_000, endMs: 119_000 });
    expect(handleKey(r, 'start', 'Home', false, D)).toEqual({ startMs: 0, endMs: 120_000 });
    expect(handleKey(r, 'end', 'End', false, D)).toEqual({ startMs: 60_000, endMs: D });
    expect(handleKey(r, 'end', 'Escape', false, D)).toBeNull();
    expect(handleKey(r, 'start', 'Tab', false, D)).toBeUndefined();
    expect(handleKey(r, 'start', 'toString', false, D)).toBeUndefined();
  });
});

describe('rangeInPull', () => {
  it('fits a range saved on a longer pull of the boss into a shorter one', () => {
    const wipe = 142_000;
    expect(rangeInPull({ startMs: 10_000, endMs: 60_000 }, wipe)).toEqual({ startMs: 10_000, endMs: 60_000 });
    expect(rangeInPull({ startMs: 100_000, endMs: 450_000 }, wipe)).toEqual({ startMs: 100_000, endMs: wipe });
    expect(rangeInPull({ startMs: 0, endMs: 450_000 }, wipe)).toBeNull();
    expect(rangeInPull({ startMs: 300_000, endMs: 450_000 }, wipe)).toBeUndefined();
    expect(rangeInPull({ startMs: 141_500, endMs: 200_000 }, wipe)).toBeUndefined();
  });
});
