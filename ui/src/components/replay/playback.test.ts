import { describe, expect, it } from 'vitest';
import type { ReplayAura, ReplayCast, ReplayTrack } from '../../api/types';
import { aurasAt, castAt, healthAt, lastTargetAt, placementAt, stacksAt } from './playback';

const track = (t: number[], x: number[], y: number[] = x.map(() => 0)): ReplayTrack => ({ actor: 1, t, x, y, facing: x.map(() => 0) });

const cast = (startMs: number, endMs: number, target: number | null = null): ReplayCast => ({
  caster: 1,
  spellId: 10,
  target,
  startMs,
  endMs,
  outcome: 'completed',
});

describe('placement', () => {
  it('interpolates linearly between samples', () => {
    expect(placementAt(track([0, 1000], [0, 10], [0, 20]), 250)).toEqual({ x: 2.5, y: 5, facing: 0, stale: false, dead: false });
  });

  it('holds and fades across a gap over 2 s', () => {
    const gap = track([0, 2500], [0, 50]);
    expect(placementAt(gap, 1000)).toMatchObject({ x: 0, stale: true });
    expect(placementAt(gap, 2400)).toMatchObject({ x: 0, stale: true });
  });

  it('interpolates a gap of exactly 2 s without fading', () => {
    expect(placementAt(track([0, 2000], [0, 20]), 1000)).toMatchObject({ x: 10, stale: false });
  });

  it('fades once the last sample is more than 2 s old', () => {
    const ended = track([0, 1000], [0, 10]);
    expect(placementAt(ended, 3000)).toMatchObject({ x: 10, stale: false });
    expect(placementAt(ended, 3001)).toMatchObject({ x: 10, stale: true });
  });

  it('is hidden before the first sample', () => {
    expect(placementAt(track([500, 1000], [0, 10]), 100)).toBeNull();
  });

  it('turns the short way round across the facing wrap', () => {
    const turning: ReplayTrack = { actor: 1, t: [0, 1000], x: [0, 0], y: [0, 0], facing: [6, 0.28] };
    const { facing } = placementAt(turning, 500)!;
    expect(Math.abs(facing - 2 * Math.PI)).toBeLessThan(0.01);
  });

  it('a dead unit stays at its death position', () => {
    const moving = track([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10_000], [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(placementAt(moving, 6000, { actor: 1, t: 4000, until: null })).toEqual({ x: 40, y: 0, facing: 0, stale: false, dead: true });
  });

  it('a resurrected unit moves again', () => {
    const moving = track([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10_000], [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    const death = { actor: 1, t: 4000, until: 6000 };
    expect(placementAt(moving, 5000, death)).toMatchObject({ x: 40, dead: true });
    expect(placementAt(moving, 8000, death)).toMatchObject({ x: 80, dead: false });
  });
});

describe('casts, auras and health', () => {
  it('cast progress at t', () => {
    const casts = [cast(1000, 3000)];
    expect(castAt(casts, 1, 2000)).toEqual({ cast: casts[0], progress: 0.5 });
    expect(castAt(casts, 1, 3500)).toBeNull();
    expect(castAt(casts, 2, 2000)).toBeNull();
  });

  it('stacks follow the logged changes', () => {
    const aura: ReplayAura = {
      target: 1,
      source: 2,
      spellId: 5,
      buff: false,
      startMs: 1000,
      endMs: 9000,
      stacks: [
        { t: 1000, stacks: 1 },
        { t: 4000, stacks: 3 },
      ],
      raidFrame: null,
    };
    expect(stacksAt(aura, 500)).toBeNull();
    expect(stacksAt(aura, 3999)).toBe(1);
    expect(stacksAt(aura, 4000)).toBe(3);
    expect(stacksAt(aura, 9000)).toBeNull();
    expect(aurasAt([aura], 1, 5000)).toEqual([aura]);
    expect(aurasAt([aura], 2, 5000)).toEqual([]);
  });

  it('health is the last sample at or before t', () => {
    const health = { actor: 1, t: [0, 1000], current: [90, 40], max: [100, 100] };
    expect(healthAt(health, -1)).toBeNull();
    expect(healthAt(health, 999)).toEqual({ current: 90, max: 100 });
    expect(healthAt(health, 1000)).toEqual({ current: 40, max: 100 });
  });

  it('last target is the target of the latest cast before t', () => {
    const casts = [cast(1000, 1000, 7), cast(3000, 3500, 8), cast(5000, 5000, null)];
    expect(lastTargetAt(casts, 1, 500)).toBeNull();
    expect(lastTargetAt(casts, 1, 4000)).toBe(8);
    expect(lastTargetAt(casts, 1, 9000)).toBe(8);
  });
});
