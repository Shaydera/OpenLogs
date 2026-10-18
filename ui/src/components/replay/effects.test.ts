import { describe, expect, it } from 'vitest';
import type { EffectInstance, ReplayData } from '../../api/types';
import { replayFixture } from '../../test/replayFixture';
import { effectsAt } from './effects';

const still = (actor: number, x: number) => ({ actor, t: [0, 60_000], x: [x, x], y: [0, 0], facing: [0, 0], map: [2001, 2001] });

const data = (effects: EffectInstance[], deaths = replayFixture.deaths): ReplayData => ({
  ...replayFixture,
  tracks: [still(1, 100), still(2, 110), still(3, 120), { actor: 4, t: [20_000, 21_000], x: [0, 10], y: [0, 0], facing: [0, 0], map: [2001, 2001] }],
  effects,
  deaths,
});

const effect = (overrides: Partial<EffectInstance>): EffectInstance => ({
  name: 'Verdant Hymn',
  spellId: 7001,
  caster: 2,
  anchor: { type: 'ground', x: 110, y: 0 },
  radiusYd: 40,
  startMs: 10_000,
  endMs: 20_000,
  estimated: false,
  kind: 'beneficial',
  category: 'heal',
  tickWindowMs: 3000,
  affected: [],
  ...overrides,
});

describe('effects', () => {
  it('living players without evidence are missing', () => {
    const replay = data([effect({ affected: [{ actor: 1, startMs: 10_000, endMs: 14_000 }] })]);
    expect(effectsAt(replay, 12_000)).toMatchObject([{ center: { x: 110, y: 0 }, affected: [1], missing: [2, 3] }]);
    expect(effectsAt(replay, 15_000)).toMatchObject([{ affected: [], missing: [1, 2, 3] }]);
    expect(effectsAt(replay, 20_000)).toEqual([]);
  });

  it('dead players are never missing', () => {
    const replay = data([effect({})], [{ actor: 3, t: 11_000, until: 13_000 }]);
    expect(effectsAt(replay, 12_000)[0].missing).toEqual([1, 2]);
    expect(effectsAt(replay, 13_000)[0].missing).toEqual([1, 2, 3]);
  });

  it('harmful effects have no missing players', () => {
    const froth = effect({ kind: 'harmful', category: 'boss_mechanic', caster: 10, affected: [{ actor: 3, startMs: 11_000, endMs: 12_000 }] });
    expect(effectsAt(data([froth]), 11_500)).toMatchObject([{ affected: [3], missing: [] }]);
  });

  it('a long effect stays up while later short ones come and go', () => {
    const totem = effect({ name: 'Linking Totem', startMs: 1_000, endMs: 40_000 });
    const short = effect({ startMs: 30_000, endMs: 31_000 });
    const replay = data([short, totem]);
    expect(effectsAt(replay, 30_500).map((state) => state.effect.name)).toEqual(['Linking Totem', 'Verdant Hymn']);
    expect(effectsAt(replay, 39_999).map((state) => state.effect.name)).toEqual(['Linking Totem']);
  });

  it('an effect without a center is list-only', () => {
    const nowhere = effect({ anchor: null, endMs: 30_000 });
    const onPet = effect({ anchor: { type: 'unit', actor: 4 }, endMs: 30_000 });
    const replay = data([nowhere, onPet]);
    expect(effectsAt(replay, 15_000).map((state) => state.center)).toEqual([null, null]);
    expect(effectsAt(replay, 20_500).map((state) => state.center)).toEqual([null, { x: 5, y: 0, stale: false }]);
    expect(effectsAt(replay, 20_500)[1].missing).toEqual([1, 2, 3]);
  });
});
