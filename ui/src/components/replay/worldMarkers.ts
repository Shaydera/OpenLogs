export type MarkerSymbol = 'square' | 'triangle' | 'diamond' | 'cross' | 'star' | 'circle' | 'moon' | 'skull';
export type MarkerLook = { symbol: MarkerSymbol; colorVar: string };

export const markerColorVar = (symbol: MarkerSymbol) => `--marker-${symbol}`;
const look = (symbol: MarkerSymbol): MarkerLook => ({ symbol, colorVar: markerColorVar(symbol) });

/** The logged world marker number `n` is the in-game slot `n + 1` (slot 1 is the blue square). */
export const WORLD_MARKERS: Record<number, MarkerLook> = {
  0: look('square'),
  1: look('triangle'),
  2: look('diamond'),
  3: look('cross'),
  4: look('star'),
  5: look('circle'),
  6: look('moon'),
  7: look('skull'),
};

/** A unit's raid target icon by its index 1..8, the lowest set bit of the logged raid flags. */
export const RAID_TARGET_MARKERS: Record<number, MarkerLook> = {
  1: look('star'),
  2: look('circle'),
  3: look('diamond'),
  4: look('triangle'),
  5: look('moon'),
  6: look('square'),
  7: look('cross'),
  8: look('skull'),
};

export const MARKER_SYMBOLS: readonly MarkerSymbol[] = ['square', 'triangle', 'diamond', 'cross', 'star', 'circle', 'moon', 'skull'];

/** The drawing calls `traceSymbol` makes; a canvas context and `SvgPath` both take them. */
export type SymbolPath = Pick<CanvasPath, 'moveTo' | 'lineTo' | 'closePath' | 'arc' | 'rect'> & { beginPath(): void };

export function traceSymbol(ctx: SymbolPath, symbol: MarkerSymbol, cx: number, cy: number, size: number) {
  const k = size / 16;
  const polygon = (points: number[]) => {
    ctx.moveTo(cx + (points[0] - 8) * k, cy + (points[1] - 8) * k);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(cx + (points[i] - 8) * k, cy + (points[i + 1] - 8) * k);
    ctx.closePath();
  };
  ctx.beginPath();
  switch (symbol) {
    case 'square':
      polygon([3, 3, 13, 3, 13, 13, 3, 13]);
      break;
    case 'triangle':
      polygon([8, 2, 14, 13, 2, 13]);
      break;
    case 'diamond':
      polygon([8, 1.5, 14, 8, 8, 14.5, 2, 8]);
      break;
    case 'cross':
      polygon([4, 2, 8, 6, 12, 2, 14, 4, 10, 8, 14, 12, 12, 14, 8, 10, 4, 14, 2, 12, 6, 8, 2, 4]);
      break;
    case 'star':
      polygon([8, 1.5, 9.9, 6, 14.6, 6.2, 10.9, 9.2, 12.2, 13.8, 8, 11.2, 3.8, 13.8, 5.1, 9.2, 1.4, 6.2, 6.1, 6]);
      break;
    case 'circle':
      ctx.arc(cx, cy, 5.5 * k, 0, 2 * Math.PI);
      break;
    case 'moon': {
      // A crescent: the outer circle's arc outside the inner one, back along the inner circle's arc.
      const r1 = 6 * k;
      const r2 = 4.6 * k;
      const d = 3.2 * k;
      const toward = -Math.PI / 4;
      const alpha = Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
      const beta = Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
      const bx = cx + d * Math.cos(toward);
      const by = cy + d * Math.sin(toward);
      ctx.arc(cx, cy, r1, toward + alpha, toward + 2 * Math.PI - alpha);
      ctx.arc(bx, by, r2, toward + Math.PI + beta, toward + Math.PI - beta, true);
      ctx.closePath();
      break;
    }
    case 'skull':
      ctx.arc(cx, cy - 1 * k, 5.5 * k, 0, 2 * Math.PI);
      ctx.rect(cx - 3 * k, cy + 2 * k, 6 * k, 4.5 * k);
      // Counter-wound eyes stay holes under the nonzero fill rule.
      ctx.moveTo(cx - 0.5 * k, cy - 0.5 * k);
      ctx.arc(cx - 2.2 * k, cy - 0.5 * k, 1.7 * k, 0, 2 * Math.PI, true);
      ctx.moveTo(cx + 3.9 * k, cy - 0.5 * k);
      ctx.arc(cx + 2.2 * k, cy - 0.5 * k, 1.7 * k, 0, 2 * Math.PI, true);
      break;
  }
}

const TAU = 2 * Math.PI;

/** The signed angle an `arc` call sweeps, as Chromium's canvas resolves it: an anticlockwise 0 → 2π is a full turn. */
function arcSweep(start: number, end: number, anticlockwise: boolean): number {
  if (!anticlockwise) {
    if (end - start >= TAU) return TAU;
    return start > end ? TAU - ((start - end) % TAU) : end - start;
  }
  if (start - end >= TAU) return -TAU;
  return start < end ? -(TAU - ((end - start) % TAU)) : end - start;
}

const coord = (value: number) => String(Math.round(value * 1000) / 1000);

/** Records canvas path calls as SVG path data. */
class SvgPath implements SymbolPath {
  private parts: string[] = [];
  private hasPoint = false;

  get d(): string {
    return this.parts.join('');
  }

  beginPath() {
    this.parts = [];
    this.hasPoint = false;
  }

  moveTo(x: number, y: number) {
    this.parts.push(`M${coord(x)} ${coord(y)}`);
    this.hasPoint = true;
  }

  lineTo(x: number, y: number) {
    this.parts.push(`${this.hasPoint ? 'L' : 'M'}${coord(x)} ${coord(y)}`);
    this.hasPoint = true;
  }

  closePath() {
    this.parts.push('Z');
  }

  rect(x: number, y: number, w: number, h: number) {
    this.parts.push(`M${coord(x)} ${coord(y)}h${coord(w)}v${coord(h)}h${coord(-w)}Z`);
    this.hasPoint = true;
  }

  arc(cx: number, cy: number, r: number, start: number, end: number, anticlockwise = false) {
    const point = (angle: number) => `${coord(cx + r * Math.cos(angle))} ${coord(cy + r * Math.sin(angle))}`;
    const sweep = arcSweep(start, end, anticlockwise);
    const flag = anticlockwise ? 0 : 1;
    this.parts.push(`${this.hasPoint ? 'L' : 'M'}${point(start)}`);
    this.hasPoint = true;
    if (Math.abs(sweep) >= TAU) {
      this.parts.push(`A${coord(r)} ${coord(r)} 0 0 ${flag} ${point(start + sweep / 2)}A${coord(r)} ${coord(r)} 0 0 ${flag} ${point(start)}`);
    } else {
      this.parts.push(`A${coord(r)} ${coord(r)} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${flag} ${point(start + sweep)}`);
    }
  }
}

/** `symbol` as SVG path data in a 16 × 16 box centred on 0, 0. */
export function symbolPath(symbol: MarkerSymbol): string {
  const path = new SvgPath();
  traceSymbol(path, symbol, 0, 0, 16);
  return path.d;
}
