import { describe, expect, it } from 'vitest';
import { abilityDetailFixture } from '../../test/reportFixtures';
import { abilityTraits, directHitsPerCast, targetsPerWindow } from './abilityTraits';

const hit = (t: number, target: number, periodic = false) => ({ t, target, amount: 1, critical: false, periodic });

describe('abilityTraits', () => {
  it('adds "cleaves" once a cast reaches 1.5 targets on average', () => {
    expect(targetsPerWindow(abilityDetailFixture)).toBe(1.25);
    expect(abilityTraits(abilityDetailFixture)).toBe('Direct damage');
    const detail = { ...abilityDetailFixture, casts: [1_000, 6_000], hits: [hit(1_100, 10), hit(1_100, 11), hit(6_100, 10), hit(6_100, 12)] };
    expect(abilityTraits(detail)).toBe('Direct damage, cleaves');
  });

  it('groups the hits of a proc without casts by their time', () => {
    const detail = { ...abilityDetailFixture, casts: [], hits: [hit(1_000, 10), hit(1_000, 11), hit(5_000, 10)] };
    expect(targetsPerWindow(detail)).toBe(1.5);
    expect(abilityTraits(detail)).toBe('Direct damage, cleaves');
  });

  it('counts only direct hits per cast and never calls a mostly periodic ability a cleave', () => {
    // Riptide: one direct heal per cast, then ticks that overlap the next cast's window on another target.
    const riptide = {
      ...abilityDetailFixture,
      metric: 'healing' as const,
      casts: [1_000, 5_000],
      hits: [
        hit(1_000, 10),
        hit(2_000, 10, true),
        hit(4_000, 10, true),
        hit(5_000, 11),
        hit(6_000, 10, true),
        hit(6_000, 11, true),
        hit(7_000, 10, true),
        hit(7_000, 11, true),
      ],
    };
    expect(targetsPerWindow(riptide)).toBe(1);
    expect(directHitsPerCast(riptide)).toBe(1);
    expect(abilityTraits(riptide)).toBe('Periodic healing');
    const blanket = { ...riptide, hits: [...riptide.hits, hit(1_000, 12), hit(5_000, 12)] };
    expect(targetsPerWindow(blanket)).toBe(2);
    expect(abilityTraits(blanket)).toBe('Periodic healing');
  });
});
