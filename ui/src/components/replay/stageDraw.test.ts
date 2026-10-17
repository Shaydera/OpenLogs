import { describe, expect, it } from 'vitest';
import type { ReplayData } from '../../api/types';
import { initialState } from '../../store';
import { replayFixture } from '../../test/replayFixture';
import { HUD_CAPTION_ROW_PX, effectLabelAt, indexStage, placeUnits } from './stageDraw';

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
    const index = indexStage(data);
    const cam = { cx: 100, cy: 200, scale: 5 };
    const filters = { ...initialState().replay.filters, hidden: [] };
    const shown = (t: number) => placeUnits(index, t, filters, cam, 640, 480).map((unit) => unit.stage.unit.actor);
    expect(shown(6_500)).toEqual([1, 11]);
    expect(shown(7_500)).toEqual([1]);
  });
});
