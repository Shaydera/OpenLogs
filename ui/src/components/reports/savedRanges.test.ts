import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteRange, loadSavedRanges, saveRange } from './savedRanges';

const KEY = '3180:15';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('saved ranges', () => {
  it('saves, replaces by name and deletes per boss and difficulty', () => {
    saveRange(KEY, { name: 'P2', startMs: 158_000, endMs: 273_000 });
    saveRange(KEY, { name: 'Burn', startMs: 400_000, endMs: 478_000 });
    expect(saveRange(KEY, { name: 'P2', startMs: 160_000, endMs: 270_000 })).toEqual([
      { name: 'P2', startMs: 160_000, endMs: 270_000 },
      { name: 'Burn', startMs: 400_000, endMs: 478_000 },
    ]);
    expect(loadSavedRanges('3180:16')).toEqual([]);
    expect(deleteRange(KEY, 'P2')).toEqual([{ name: 'Burn', startMs: 400_000, endMs: 478_000 }]);
    expect(loadSavedRanges(KEY)).toEqual([{ name: 'Burn', startMs: 400_000, endMs: 478_000 }]);
  });

  it('survives a storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadSavedRanges(KEY)).toEqual([]);
    expect(saveRange(KEY, { name: 'P2', startMs: 0, endMs: 1 })).toEqual([{ name: 'P2', startMs: 0, endMs: 1 }]);
  });

  it('drops corrupt and tampered entries and keeps the first of each name', () => {
    localStorage.setItem(`openlogs.ranges.${KEY}`, '{not json');
    expect(loadSavedRanges(KEY)).toEqual([]);
    localStorage.setItem(
      `openlogs.ranges.${KEY}`,
      JSON.stringify([
        { name: 'P2', startMs: 158_000, endMs: 273_000 },
        'x',
        { name: 3 },
        { name: 'Frac', startMs: 1.5, endMs: 3_000 },
        { name: 'Inverted', startMs: 5_000, endMs: 1_000 },
        { name: 'Neg', startMs: -1_000, endMs: 1_000 },
        { name: '  ', startMs: 0, endMs: 1_000 },
        { name: 'x'.repeat(25), startMs: 0, endMs: 1_000 },
        { name: 'Huge', startMs: 0, endMs: 2 ** 31 },
        { name: 'y'.repeat(24), startMs: 0, endMs: 2 ** 31 - 1 },
        { name: 'P2', startMs: 0, endMs: 1_000 },
      ]),
    );
    expect(loadSavedRanges(KEY)).toEqual([
      { name: 'P2', startMs: 158_000, endMs: 273_000 },
      { name: 'y'.repeat(24), startMs: 0, endMs: 2 ** 31 - 1 },
    ]);
  });
});
