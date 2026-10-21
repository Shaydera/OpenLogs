import type { LogView, Seam } from '../../api/types';
import { type PullView, pullView } from '../../pulls/groupPulls';
import { band } from '../player/chartGeometry';

export interface SeamBox extends Seam {
  flex: number;
}

export function seamBoxes(seams: Seam[]): SeamBox[] {
  return seams.map((seam) => ({ ...seam, flex: seam.endMs - seam.startMs }));
}

export function bandIn(seam: Seam, [start, end]: [number, number]) {
  return band(start, end, seam.startMs, seam.endMs);
}

export function pullViews(log: LogView, fights: number[]): Map<number, PullView> {
  const views = new Map<number, PullView>();
  for (const index of fights) {
    const view = pullView(log.fights, index);
    if (view) views.set(index, view);
  }
  return views;
}
