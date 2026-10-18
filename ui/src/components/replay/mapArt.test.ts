import { describe, expect, it } from 'vitest';
import type { MapArtEntry, MapArtTable, ReplayData, ReplayDeath, ReplayTrack } from '../../api/types';
import { replayFixture } from '../../test/replayFixture';
import { ARENA_SIZE_YD, mapImageUrl, pinToWorld, robustBounds, stageMap } from './mapArt';

const RAID_FLOOR = 2001;
const OTHER_FLOOR = 2002;

const entry = (overrides: Partial<MapArtEntry> = {}): MapArtEntry => ({
  zone: 17001,
  floor: 2,
  raid: true,
  minX: 0,
  maxX: 400,
  minY: 0,
  maxY: 400,
  ...overrides,
});

const table = (maps: Record<string, MapArtEntry>, pin = { uiMapId: RAID_FLOOR, u: 0.5, v: 0.5 }): MapArtTable => ({
  maps,
  pins: { [replayFixture.encounterId]: pin },
});

const track = (actor: number, points: [number, number][], map = RAID_FLOOR): ReplayTrack => ({
  actor,
  t: points.map((_, i) => i * 1000),
  x: points.map(([x]) => x),
  y: points.map(([, y]) => y),
  facing: points.map(() => 0),
  map: points.map(() => map),
});

const pull = (tracks: ReplayTrack[], overrides: Partial<ReplayData> = {}): ReplayData => ({
  ...replayFixture,
  tracks,
  deaths: [],
  ...overrides,
});

const square = (x: number, y: number, size: number) => ({ minX: x - size / 2, maxX: x + size / 2, minY: y - size / 2, maxY: y + size / 2 });

describe('the stage map of a pull', () => {
  it('converts a journal pin to world yards through the map bounds', () => {
    const world = pinToWorld({ u: 0.545999, v: 0.723873 }, { minX: 175, maxX: 940, minY: -113.75, maxY: 1033.75 });
    expect(world.x).toBeCloseTo(386.2, 1);
    expect(world.y).toBeCloseTo(407.2, 1);
  });

  it('the opening frame is the same for two pulls of one boss', () => {
    const art = table({ [RAID_FLOOR]: entry() });
    const huddled = pull([track(1, [[200, 200]]), track(2, [[205, 195]]), track(3, [[195, 205]])]);
    const scattered = pull([track(1, [[20, 380]]), track(2, [[300, 40]]), track(3, [[150, 250]])]);

    expect(stageMap(huddled, art).frame).toEqual(square(200, 200, ARENA_SIZE_YD));
    expect(stageMap(scattered, art).frame).toEqual(stageMap(huddled, art).frame);
  });

  it("falls back to the majority floor when the pin's floor holds less than half", () => {
    const art = table({ [RAID_FLOOR]: entry(), [OTHER_FLOOR]: entry({ floor: 3 }) });
    const data = pull([
      track(1, [[200, 200], [200, 200]], RAID_FLOOR),
      track(2, [[50, 60], [52, 62]], OTHER_FLOOR),
      track(3, [[54, 64], [56, 66]], OTHER_FLOOR),
    ]);

    const map = stageMap(data, art);
    expect(map.uiMapId).toBe(OTHER_FLOOR);
    expect(map.frame).toEqual({ minX: 50, maxX: 56, minY: 60, maxY: 66 });
  });

  it('an arena frame correction wins over the pin', () => {
    const data = pull([track(1, [[200, 200]])], { arenaFrame: { uiMapId: RAID_FLOOR, x: 300, y: 100, sizeYd: 80 } });

    expect(stageMap(data, table({ [RAID_FLOOR]: entry() })).frame).toEqual(square(300, 100, 80));
  });

  it("an arena frame correction's floor is preferred over the pin's floor", () => {
    const art = table({ [RAID_FLOOR]: entry(), [OTHER_FLOOR]: entry({ floor: 3 }) });
    const data = pull([track(1, [[200, 200]], RAID_FLOOR), track(2, [[300, 100]], OTHER_FLOOR)], {
      arenaFrame: { uiMapId: OTHER_FLOOR, x: 300, y: 100, sizeYd: 80 },
    });

    const map = stageMap(data, art);
    expect(map.uiMapId).toBe(OTHER_FLOOR);
    expect(map.frame).toEqual(square(300, 100, 80));
  });

  it('a pin away from every player falls back to the robust fit', () => {
    const art = table({ [RAID_FLOOR]: entry() });
    const nearPin = pull([track(1, [[230, 180]]), track(2, [[300, 300]])]);
    const farFromPin = pull([track(1, [[300, 300]]), track(2, [[310, 320]])]);

    expect(stageMap(nearPin, art).frame).toEqual(square(200, 200, ARENA_SIZE_YD));
    expect(stageMap(farFromPin, art).frame).toEqual({ minX: 300, maxX: 310, minY: 300, maxY: 320 });
  });

  it('uses exported bounds when the log has none', () => {
    const exported = entry({ minX: 0, maxX: 200, minY: 0, maxY: 200 });
    const logged = { uiMapId: RAID_FLOOR, minX: 0, maxX: 600, minY: 0, maxY: 600 };
    const tracks = [track(1, [[100, 100]]), track(2, [[300, 300]])];

    const fromExport = stageMap(pull(tracks), table({ [RAID_FLOOR]: exported }));
    expect(fromExport.bounds).toEqual({ minX: 0, maxX: 200, minY: 0, maxY: 200 });
    expect(fromExport.frame).toEqual(square(100, 100, ARENA_SIZE_YD));

    const fromLog = stageMap(pull(tracks, { maps: [logged] }), table({ [RAID_FLOOR]: exported }));
    expect(fromLog.bounds).toEqual({ minX: 0, maxX: 600, minY: 0, maxY: 600 });
    expect(fromLog.frame).toEqual(square(300, 300, ARENA_SIZE_YD));

    const unknown = stageMap(pull(tracks), table({}));
    expect(unknown.bounds).toBeNull();
    expect(unknown.imageUrl).toBeNull();
    expect(unknown.frame).toEqual({ minX: 100, maxX: 300, minY: 100, maxY: 300 });
  });

  it('robust fit ignores a far outlier and dead players', () => {
    const steps = Array.from({ length: 20 }, (_, i) => i);
    const tank = steps.map((i): [number, number] => (i === 10 ? [900, 200] : [100 + (i % 3), 200]));
    const healer = steps.map((i): [number, number] => [110, 210 + (i % 3)]);
    const released = steps.map((i): [number, number] => (i < 10 ? [105, 205] : [-500, -500]));
    const deaths: ReplayDeath[] = [{ actor: 3, t: 10_000, until: null }];
    const data = pull([track(1, tank), track(2, healer), track(3, released)], { deaths });

    expect(robustBounds(data, RAID_FLOOR)).toEqual({ minX: 100, maxX: 110, minY: 200, maxY: 212 });
  });

  it('no image for a dungeon map', () => {
    const map = stageMap(pull([track(1, [[200, 200]])]), table({ [RAID_FLOOR]: entry({ raid: false }) }));

    expect(map.imageUrl).toBeNull();
    expect(map.frame).toEqual(square(200, 200, ARENA_SIZE_YD));
  });

  it('image url uses the floor or the bare zone', () => {
    expect(mapImageUrl({ zone: 16915, floor: 0 })).toBe('https://wow.zamimg.com/images/wow/maps/enus/original/16915-0.jpg');
    expect(mapImageUrl({ zone: 16915, floor: 3 })).toBe('https://wow.zamimg.com/images/wow/maps/enus/original/16915-3.jpg');
    expect(mapImageUrl({ zone: 16915, floor: null })).toBe('https://wow.zamimg.com/images/wow/maps/enus/original/16915.jpg');
    expect(stageMap(pull([track(1, [[200, 200]])]), table({ [RAID_FLOOR]: entry() })).imageUrl).toBe(mapImageUrl(entry()));
  });
});
