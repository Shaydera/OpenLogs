import { describe, expect, it } from 'vitest';
import type { EffectAnchor, MapArtTable, ReplayData, ReplayTrack } from '../../api/types';
import { type ReplayLayers, initialState } from '../../store';
import { replayFixture } from '../../test/replayFixture';
import type { EffectState } from './effects';
import type { StageColors } from './stageColors';
import { HUD_CAPTION_ROW_PX, type StageFrame, type StageIndex, drawStage, effectLabelAt, effectsOnStage, indexStage, mapArtOnScreen, placeUnits } from './stageDraw';

const SHOWN_FLOOR = 2001;
const OTHER_FLOOR = 2002;

const still = (actor: number, x: number, y: number, map = SHOWN_FLOOR): ReplayTrack => ({ actor, t: [0, 1_000], x: [x, x], y: [y, y], facing: [0, 0], map: [map, map] });
const filters = { ...initialState().replay.filters, hidden: [] };
const CAM = { cx: 100, cy: 200, scale: 5 };

const frameOf = (index: StageIndex): StageFrame => ({
  w: 640,
  h: 480,
  t: 500,
  cam: CAM,
  colors: { effects: {}, markers: {}, classes: {} } as StageColors,
  index,
  placed: [],
  layers: initialState().replay.layers,
  selected: null,
  highlight: null,
  hover: null,
  effects: [],
  selectedEffect: null,
  image: () => null,
  mapArt: null,
});

function drawn(frame: StageFrame): { name: string; args: unknown[] }[] {
  const calls: { name: string; args: unknown[] }[] = [];
  const record =
    (name: PropertyKey) =>
    (...args: unknown[]) => {
      calls.push({ name: String(name), args });
      return name === 'measureText' ? { width: 0 } : undefined;
    };
  const ctx = new Proxy({} as Record<PropertyKey, unknown>, { get: (target, name) => (name in target ? target[name] : record(name)) });
  drawStage(ctx as unknown as CanvasRenderingContext2D, frame);
  return calls;
}

const effectState = (anchor: EffectAnchor): EffectState => ({
  effect: {
    name: 'Verdant Hymn',
    spellId: 7001,
    caster: 2,
    anchor,
    radiusYd: 10,
    startMs: 0,
    endMs: 10_000,
    estimated: false,
    kind: 'beneficial',
    category: 'heal',
    tickWindowMs: 3000,
    affected: [],
  },
  center: anchor.type === 'ground' ? { x: anchor.x, y: anchor.y, stale: false } : { x: 0, y: 0, stale: false },
  affected: [],
  missing: [],
});

describe('effect labels', () => {
  it('sit above their circle', () => {
    expect(effectLabelAt(300, 300, 100, 80, 640, 480)).toEqual([300, 194]);
  });

  it('stay on the stage, below the HUD captions, when the circle reaches its edges', () => {
    const [x, bottom] = effectLabelAt(20, 60, 200, 80, 640, 480);
    expect(x - 40).toBeGreaterThanOrEqual(0);
    expect(bottom - 12).toBeGreaterThanOrEqual(HUD_CAPTION_ROW_PX);
  });
});

describe('units on the stage', () => {
  it('drop an enemy that stopped logging, while a silent player stays', () => {
    const data: ReplayData = {
      ...replayFixture,
      tracks: [
        { actor: 1, t: [0, 1_000], x: [100, 101], y: [200, 201], facing: [0, 0], map: [2001, 2001] },
        { actor: 11, t: [0, 1_000], x: [104, 104], y: [204, 204], facing: [0, 0], map: [2001, 2001] },
      ],
      health: [{ actor: 11, t: [0, 2_000], current: [500, 400], max: [500, 500] }],
    };
    const index = indexStage(data, null);
    const shown = (t: number) => placeUnits(index, t, filters, CAM, 640, 480).placed.map((unit) => unit.stage.unit.actor);
    expect(shown(6_500)).toEqual([1, 11]);
    expect(shown(7_500)).toEqual([1]);
  });
});

describe('the map image on the stage', () => {
  it('the map image sits north up and west left by its bounds', () => {
    const placement = mapArtOnScreen({ cx: 200, cy: 100, scale: 1 }, { minX: 0, maxX: 400, minY: 0, maxY: 200 }, 640, 480);

    expect(placement).toEqual({ origin: [220, 40], right: [200, 0], down: [0, 400] });
  });

  it('units on another floor are not drawn and are counted', () => {
    const data: ReplayData = {
      ...replayFixture,
      tracks: [still(1, 100, 200), still(2, 102, 202), still(3, 300, 400, OTHER_FLOOR), still(10, 105, 205, 0)],
    };
    const { placed, otherFloor } = placeUnits(indexStage(data, null), 500, filters, CAM, 640, 480);

    expect(placed.map((unit) => unit.stage.unit.actor)).toEqual([1, 2, 10]);
    expect(otherFloor.map((stage) => stage.unit.actor)).toEqual([3]);
  });

  it('without art the grid is drawn even when the grid layer is off', () => {
    const table: MapArtTable = {
      maps: { [SHOWN_FLOOR]: { zone: 17001, floor: 1, raid: true, minX: 0, maxX: 400, minY: 0, maxY: 400 } },
      pins: {},
    };
    const index = indexStage({ ...replayFixture, tracks: [still(1, 100, 200)] }, table);
    const art = { naturalWidth: 1024, naturalHeight: 1024 } as HTMLImageElement;
    const gridOff: ReplayLayers = { ...initialState().replay.layers, grid: false };
    const linesDrawn = (mapArt: HTMLImageElement | null, layers: ReplayLayers) => drawn({ ...frameOf(index), mapArt, layers }).filter(({ name }) => name === 'lineTo').length;
    const scaleBarOnly = linesDrawn(art, gridOff);

    expect(linesDrawn(null, gridOff)).toBeGreaterThan(scaleBarOnly);
    expect(linesDrawn(art, { ...gridOff, grid: true })).toBeGreaterThan(scaleBarOnly);
  });
});

describe('units on another floor', () => {
  const index = indexStage({ ...replayFixture, tracks: [still(1, 100, 200), still(2, 102, 202), still(3, 300, 400, OTHER_FLOOR)] }, null);

  it('the tooltip gives no distance to a selected unit on another floor', () => {
    const [hovered] = placeUnits(index, 500, filters, CAM, 640, 480).placed;
    const tooltipText = (selected: number) =>
      drawn({ ...frameOf(index), placed: [hovered], hover: hovered, selected })
        .filter(({ name }) => name === 'fillText')
        .map(({ args }) => String(args[0]));

    expect(tooltipText(2).some((text) => text.includes('Miravel'))).toBe(true);
    expect(tooltipText(3).some((text) => text.includes('Orsek'))).toBe(false);
  });

  it('effects anchored to a unit on another floor are left off the stage', () => {
    const anchoredTo = (actor: number) => effectState({ type: 'unit', actor });
    const ground = effectState({ type: 'ground', x: 100, y: 200 });

    expect(effectsOnStage(index, [anchoredTo(1), anchoredTo(3), ground], 500)).toEqual([anchoredTo(1), ground]);
  });
});
