/** Where the stage looks: the world point at its centre and the zoom in px per yard. */
export type Camera = { cx: number; cy: number; scale: number };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/** The zoom limits keep a grid step from `GRID_STEPS` between 40 and 120 px apart. */
export const MIN_SCALE = 0.8;
export const MAX_SCALE = 120;
/** A fit never shows less than this many yards across, so a lone point does not zoom in all the way. */
const MIN_FIT_SPAN = 20;
const GRID_STEPS = [1, 2, 5, 10, 20, 50];
const MIN_GRID_PX = 40;

const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/**
 * The stage's orientation, north up as in game: the screen direction (right, down) of one yard along world x (north)
 * and along world y (west). `toWorld` inverts it by transposing, which holds for any rotation or mirroring.
 */
const WORLD_X_ON_SCREEN: [number, number] = [0, -1];
const WORLD_Y_ON_SCREEN: [number, number] = [-1, 0];

/** The camera that shows all of `bounds` inside a stage `w` × `h` px, `padPx` in from every edge. */
export function fitCamera(bounds: Bounds, w: number, h: number, padPx: number): Camera {
  const spanX = Math.max(bounds.maxX - bounds.minX, MIN_FIT_SPAN);
  const spanY = Math.max(bounds.maxY - bounds.minY, MIN_FIT_SPAN);
  const across = Math.abs(spanX * WORLD_X_ON_SCREEN[0]) + Math.abs(spanY * WORLD_Y_ON_SCREEN[0]);
  const down = Math.abs(spanX * WORLD_X_ON_SCREEN[1]) + Math.abs(spanY * WORLD_Y_ON_SCREEN[1]);
  const scale = Math.min(Math.max(1, w - 2 * padPx) / across, Math.max(1, h - 2 * padPx) / down);
  return { cx: (bounds.minX + bounds.maxX) / 2, cy: (bounds.minY + bounds.maxY) / 2, scale: clampScale(scale) };
}

export function toScreen(cam: Camera, x: number, y: number, w: number, h: number): [number, number] {
  const dx = (x - cam.cx) * cam.scale;
  const dy = (y - cam.cy) * cam.scale;
  return [w / 2 + dx * WORLD_X_ON_SCREEN[0] + dy * WORLD_Y_ON_SCREEN[0], h / 2 + dx * WORLD_X_ON_SCREEN[1] + dy * WORLD_Y_ON_SCREEN[1]];
}

export function toWorld(cam: Camera, sx: number, sy: number, w: number, h: number): [number, number] {
  const right = (sx - w / 2) / cam.scale;
  const down = (sy - h / 2) / cam.scale;
  return [cam.cx + right * WORLD_X_ON_SCREEN[0] + down * WORLD_X_ON_SCREEN[1], cam.cy + right * WORLD_Y_ON_SCREEN[0] + down * WORLD_Y_ON_SCREEN[1]];
}

/** The screen direction (right, down) of a logged facing: radians, 0 north, growing counter-clockwise towards west. */
export function facingOnScreen(facing: number): [number, number] {
  const [north, west] = [Math.cos(facing), Math.sin(facing)];
  return [north * WORLD_X_ON_SCREEN[0] + west * WORLD_Y_ON_SCREEN[0], north * WORLD_X_ON_SCREEN[1] + west * WORLD_Y_ON_SCREEN[1]];
}

/** `cam` zoomed by `factor` (above 1 zooms in) with the world point under (`sx`, `sy`) staying there. */
export function zoomAt(cam: Camera, factor: number, sx: number, sy: number, w: number, h: number): Camera {
  const [x, y] = toWorld(cam, sx, sy, w, h);
  const scale = clampScale(cam.scale * factor);
  const zoomed = { ...cam, scale };
  const [nx, ny] = toWorld(zoomed, sx, sy, w, h);
  return { cx: cam.cx + x - nx, cy: cam.cy + y - ny, scale };
}

/** `cam` after the content was dragged by (`dxPx`, `dyPx`): the world follows the pointer. */
export function panCamera(cam: Camera, dxPx: number, dyPx: number): Camera {
  const [x0, y0] = toWorld(cam, 0, 0, 0, 0);
  const [x1, y1] = toWorld(cam, dxPx, dyPx, 0, 0);
  return { ...cam, cx: cam.cx - (x1 - x0), cy: cam.cy - (y1 - y0) };
}

type Point = { x: number; y: number };
/** Fingers closer than this count as this far apart, so a pinch that starts with them nearly stacked does not leap. */
const PINCH_MIN_PX = 24;

/** `origin` after two fingers moved from `from` to `to`: the zoom follows their spread, the world point between them follows their midpoint. */
export function pinchCamera(origin: Camera, from: readonly [Point, Point], to: readonly [Point, Point], w: number, h: number): Camera {
  const apart = ([a, b]: readonly [Point, Point]) => Math.max(PINCH_MIN_PX, Math.hypot(b.x - a.x, b.y - a.y));
  const mid = ([a, b]: readonly [Point, Point]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const [m0, m1] = [mid(from), mid(to)];
  return panCamera(zoomAt(origin, apart(to) / apart(from), m0.x, m0.y, w, h), m1.x - m0.x, m1.y - m0.y);
}

/** Yards between grid lines at `scale`: the smallest step at least 40 px apart. */
export function gridStep(scale: number): number {
  return GRID_STEPS.find((step) => step * scale >= MIN_GRID_PX) ?? GRID_STEPS[GRID_STEPS.length - 1];
}
