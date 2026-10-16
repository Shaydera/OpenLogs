import type { ReplayData, ReplayDeath, ReplayHealthTrack, ReplayRaidMarker, ReplayTrack, ReplayUnit, ReplayWorldMarker } from '../../api/types';
import { formatFixed, formatInteger } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { type IconRef, bossIcon, classIcon, specIcon } from '../../icons';
import { bossMonogram, initials } from '../../monogram';
import type { ReplayFilters, ReplayLayers } from '../../store';
import { shortName } from '../overview/players';
import { type Bounds, type Camera, facingOnScreen, gridStep, toScreen, toWorld } from './camera';
import { healthAt, placementAt } from './playback';
import type { StageColors } from './stageColors';
import { type MarkerLook, type MarkerSymbol, RAID_TARGET_MARKERS, WORLD_MARKERS } from './worldMarkers';

export const STAGE_PAD_PX = 40;
const HIT_PX = 14;
const UNIT_PX: Record<ReplayUnit['kind'], number> = { player: 22, pet: 16, boss: 28, add: 22 };
const WORLD_MARKER_PX = 26;
const KIND_FILTER: Record<ReplayUnit['kind'], keyof Omit<ReplayFilters, 'hidden'>> = { player: 'players', pet: 'pets', boss: 'bosses', add: 'adds' };

export interface StageUnit {
  unit: ReplayUnit;
  track: ReplayTrack;
  /** Sorted by `t`. */
  deaths: ReplayDeath[];
  raidMarkers: ReplayRaidMarker[];
  health: ReplayHealthTrack | undefined;
  /** Lower-case class token of a player or a pet's owner. */
  classKey: string | null;
  label: string;
  icon: IconRef | null;
  monogram: string;
}

export interface StageIndex {
  units: StageUnit[];
  byActor: Map<number, StageUnit>;
  worldMarkers: ReplayWorldMarker[];
  bounds: Bounds | null;
}

export interface PlacedUnit {
  stage: StageUnit;
  x: number;
  y: number;
  sx: number;
  sy: number;
  facing: number;
  stale: boolean;
  dead: boolean;
}

function groupBy<T>(items: T[], key: (item: T) => number): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

/** All logged positions of the pull, `null` without any. */
export function stageBounds(data: ReplayData): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const track of data.tracks) {
    for (const x of track.x) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
    for (const y of track.y) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}

function unitIcon(unit: ReplayUnit, encounterId: number): IconRef | null {
  if (unit.kind === 'boss') return encounterId > 0 ? bossIcon(encounterId) : null;
  if (unit.specId !== null) return specIcon(unit.specId);
  if (unit.classId !== null && unit.kind === 'player') return classIcon(unit.classId);
  return null;
}

/** The bundle's per-unit lookups, built once so the stage does not scan the whole bundle every frame. */
export function indexStage(data: ReplayData): StageIndex {
  const tracks = new Map(data.tracks.map((track) => [track.actor, track]));
  const health = new Map(data.health.map((track) => [track.actor, track]));
  const deaths = groupBy(data.deaths, (death) => death.actor);
  const raidMarkers = groupBy(data.raidMarkers, (marker) => marker.actor);
  const classTokens = new Map(data.roster.map((player) => [player.actorId, player.classToken?.toLowerCase() ?? null]));
  const units: StageUnit[] = [];
  for (const unit of data.units) {
    const track = tracks.get(unit.actor);
    if (!track) continue;
    const label = unit.kind === 'player' ? shortName(unit.name) : unit.name;
    units.push({
      unit,
      track,
      deaths: [...(deaths.get(unit.actor) ?? [])].sort((a, b) => a.t - b.t),
      raidMarkers: raidMarkers.get(unit.actor) ?? [],
      health: health.get(unit.actor),
      classKey: classTokens.get(unit.kind === 'pet' ? (unit.owner ?? -1) : unit.actor) ?? null,
      label,
      icon: unitIcon(unit, data.encounterId),
      monogram: unit.kind === 'boss' ? bossMonogram(label) : unit.kind === 'player' ? label.slice(0, 2) : initials(label).toUpperCase(),
    });
  }
  return { units, byActor: new Map(units.map((stage) => [stage.unit.actor, stage])), worldMarkers: data.worldMarkers, bounds: stageBounds(data) };
}

/** Where `stage` is at `t`, with the death that may hold it in place. */
export function placeUnit(stage: StageUnit, t: number) {
  let death: ReplayDeath | undefined;
  for (const candidate of stage.deaths) {
    if (candidate.t > t) break;
    death = candidate;
  }
  return placementAt(stage.track, t, death);
}

/** The units `filters` shows at `t`, with their screen positions. */
export function placeUnits(index: StageIndex, t: number, filters: ReplayFilters, cam: Camera, w: number, h: number): PlacedUnit[] {
  const hidden = new Set(filters.hidden);
  const placed: PlacedUnit[] = [];
  for (const stage of index.units) {
    if (!filters[KIND_FILTER[stage.unit.kind]] || hidden.has(stage.unit.actor)) continue;
    const at = placeUnit(stage, t);
    if (!at) continue;
    const [sx, sy] = toScreen(cam, at.x, at.y, w, h);
    placed.push({ stage, ...at, sx, sy });
  }
  return placed;
}

/** The unit nearest to (`sx`, `sy`) within 14 px, else `null`. */
export function hitUnit(placed: PlacedUnit[], sx: number, sy: number): PlacedUnit | null {
  let best: PlacedUnit | null = null;
  let bestDistance = HIT_PX;
  for (const unit of placed) {
    const distance = Math.hypot(unit.sx - sx, unit.sy - sy);
    if (distance <= bestDistance) {
      best = unit;
      bestDistance = distance;
    }
  }
  return best;
}

const images = new Map<string, HTMLImageElement>();
const waiting = new Map<string, Set<() => void>>();

/** The image at `src` once loaded, loading it on first use; until then `null`, and `onSettled` runs once it loads or fails. A broken image stays `null`. */
export function stageImage(src: string, onSettled: () => void): HTMLImageElement | null {
  let image = images.get(src);
  if (!image) {
    const loading = new Image();
    const settle = () => {
      waiting.get(src)?.forEach((listener) => listener());
      waiting.delete(src);
    };
    loading.addEventListener('load', settle, { once: true });
    loading.addEventListener('error', settle, { once: true });
    loading.decoding = 'async';
    loading.src = src;
    images.set(src, loading);
    image = loading;
  }
  if (!image.complete) {
    const listeners = waiting.get(src) ?? new Set();
    listeners.add(onSettled);
    waiting.set(src, listeners);
    return null;
  }
  return image.naturalWidth > 0 ? image : null;
}

export interface StageFrame {
  w: number;
  h: number;
  t: number;
  cam: Camera;
  colors: StageColors;
  index: StageIndex;
  placed: PlacedUnit[];
  layers: ReplayLayers;
  selected: number | null;
  highlight: ReadonlySet<number> | null;
  hover: PlacedUnit | null;
  /** The loaded image of an icon ref, else `null`. */
  image: (icon: IconRef) => HTMLImageElement | null;
}

const font = (weight: number, px: number, family: string) => `${weight} ${px}px ${family}`;

function traceSymbol(ctx: CanvasRenderingContext2D, symbol: MarkerSymbol, cx: number, cy: number, size: number) {
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

function drawGrid(ctx: CanvasRenderingContext2D, { w, h, cam, colors }: StageFrame) {
  const step = gridStep(cam.scale);
  const corners = [toWorld(cam, 0, 0, w, h), toWorld(cam, w, h, w, h), toWorld(cam, 0, h, w, h), toWorld(cam, w, 0, w, h)];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const crisp = (v: number) => Math.round(v) + 0.5;
  ctx.save();
  ctx.strokeStyle = colors.muted;
  ctx.globalAlpha = 0.08;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const [ax, ay] = toScreen(cam, x0, y0, w, h);
    const [bx, by] = toScreen(cam, x1, y1, w, h);
    ctx.moveTo(crisp(ax), crisp(ay));
    ctx.lineTo(crisp(bx), crisp(by));
  };
  for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) line(x, minY, x, maxY);
  for (let y = Math.ceil(minY / step) * step; y <= maxY; y += step) line(minX, y, maxX, y);
  ctx.stroke();
  ctx.restore();

  const barPx = step * cam.scale;
  const x0 = 14.5;
  const y0 = Math.round(h - 14) + 0.5;
  ctx.save();
  ctx.strokeStyle = colors.muted;
  ctx.fillStyle = colors.muted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0 - 4);
  ctx.lineTo(x0, y0);
  ctx.lineTo(x0 + barPx, y0);
  ctx.lineTo(x0 + barPx, y0 - 4);
  ctx.stroke();
  ctx.font = font(400, 11, colors.fontText);
  ctx.textBaseline = 'bottom';
  ctx.fillText(t('unit.yards', { value: step }), x0 + 2, y0 - 4);
  ctx.restore();
}

function drawSymbol(ctx: CanvasRenderingContext2D, look: MarkerLook, colors: StageColors, cx: number, cy: number, size: number) {
  ctx.fillStyle = colors.markers[look.symbol];
  traceSymbol(ctx, look.symbol, cx, cy, size);
  ctx.fill();
}

function drawWorldMarkers(ctx: CanvasRenderingContext2D, { w, h, t: now, cam, colors, index }: StageFrame) {
  const r = WORLD_MARKER_PX / 2;
  for (const marker of index.worldMarkers) {
    const look = WORLD_MARKERS[marker.marker];
    if (!look || now < marker.startMs || now >= marker.endMs) continue;
    const [sx, sy] = toScreen(cam, marker.x, marker.y, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, 2 * Math.PI);
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = colors.text;
    ctx.fill();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = colors.text;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
    drawSymbol(ctx, look, colors, sx, sy, 16);
    ctx.restore();
  }
}

function unitColor(stage: StageUnit, colors: StageColors): string {
  if (stage.unit.kind === 'boss') return colors.boss;
  if (stage.unit.kind === 'add') return colors.add;
  return (stage.classKey && colors.classes[stage.classKey]) || colors.text;
}

function labelColor(unit: PlacedUnit, colors: StageColors): string {
  if (unit.dead) return colors.muted;
  return unit.stage.classKey ? unitColor(unit.stage, colors) : colors.text;
}

function traceShape(ctx: CanvasRenderingContext2D, kind: ReplayUnit['kind'], sx: number, sy: number, half: number) {
  ctx.beginPath();
  if (kind === 'player' || kind === 'pet') ctx.arc(sx, sy, half, 0, 2 * Math.PI);
  else ctx.roundRect(sx - half, sy - half, half * 2, half * 2, kind === 'boss' ? 5 : 3);
}

function drawImageCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, sx: number, sy: number, half: number) {
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  ctx.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, sx - half, sy - half, half * 2, half * 2);
}

function activeRaidMarker(stage: StageUnit, now: number): MarkerLook | null {
  const marker = stage.raidMarkers.find((m) => m.startMs <= now && now < m.endMs);
  return marker ? (RAID_TARGET_MARKERS[marker.marker] ?? null) : null;
}

function drawUnit(ctx: CanvasRenderingContext2D, frame: StageFrame, unit: PlacedUnit) {
  const { colors, layers, selected, highlight } = frame;
  const { stage, sx, sy } = unit;
  const { kind } = stage.unit;
  const half = UNIT_PX[kind] / 2;
  const isSelected = stage.unit.actor === selected;
  const highlighted = highlight?.has(stage.unit.actor) ?? false;
  const fill = unit.dead ? colors.dead : unitColor(stage, colors);

  ctx.save();
  ctx.globalAlpha = (unit.stale ? 0.5 : 1) * (highlight && !highlighted && !isSelected ? 0.35 : 1);

  if (isSelected || highlighted) {
    ctx.beginPath();
    ctx.arc(sx, sy, half + 4, 0, 2 * Math.PI);
    ctx.strokeStyle = isSelected ? colors.accent : colors.text;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  if (isSelected) {
    ctx.save();
    ctx.globalAlpha *= 0.33;
    ctx.beginPath();
    ctx.arc(sx, sy, half + 6.5, 0, 2 * Math.PI);
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  const image = stage.icon ? frame.image(stage.icon) : null;
  traceShape(ctx, kind, sx, sy, half);
  if (image) {
    ctx.save();
    ctx.clip();
    if (unit.dead) ctx.filter = 'grayscale(1)';
    drawImageCover(ctx, image, sx, sy, half);
    ctx.restore();
  } else {
    ctx.fillStyle = fill;
    ctx.fill();
    if (kind !== 'pet') {
      ctx.fillStyle = colors.plot;
      ctx.font = font(700, kind === 'boss' ? 11 : 10, colors.fontLabel);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(stage.monogram, sx, sy + 0.5);
    }
  }
  const round = kind === 'player' || kind === 'pet';
  traceShape(ctx, kind, sx, sy, round ? half - 1 : half);
  ctx.strokeStyle = round ? fill : colors.iconRing;
  ctx.lineWidth = round ? 2 : 1;
  ctx.stroke();

  if (layers.facing && !unit.dead) {
    const [dx, dy] = facingOnScreen(unit.facing);
    const base = half + 2;
    const tip = half + 7;
    ctx.beginPath();
    ctx.moveTo(sx + dx * tip, sy + dy * tip);
    ctx.lineTo(sx + dx * base - dy * 3.5, sy + dy * base + dx * 3.5);
    ctx.lineTo(sx + dx * base + dy * 3.5, sy + dy * base - dx * 3.5);
    ctx.closePath();
    ctx.fillStyle = colors.text;
    ctx.fill();
  }

  const raidMarker = activeRaidMarker(stage, frame.t);
  if (raidMarker) {
    const mx = sx + half * 0.8;
    const my = sy - half * 0.8;
    ctx.beginPath();
    ctx.arc(mx, my, 6.5, 0, 2 * Math.PI);
    ctx.fillStyle = colors.plot;
    ctx.fill();
    drawSymbol(ctx, raidMarker, colors, mx, my, 11);
  }
  ctx.restore();
}

function drawName(ctx: CanvasRenderingContext2D, frame: StageFrame, unit: PlacedUnit) {
  const { colors } = frame;
  const isSelected = unit.stage.unit.actor === frame.selected;
  const top = unit.sy + UNIT_PX[unit.stage.unit.kind] / 2 + (isSelected ? 9 : 3);
  ctx.save();
  ctx.globalAlpha = unit.stale ? 0.6 : 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  if (isSelected) {
    ctx.font = font(600, 12, colors.fontText);
    const width = ctx.measureText(unit.stage.label).width + 12;
    ctx.beginPath();
    ctx.roundRect(unit.sx - width / 2, top - 1, width, 18, 4);
    ctx.fillStyle = colors.panelRaised;
    ctx.fill();
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = labelColor(unit, colors);
    ctx.fillText(unit.stage.label, unit.sx, top + 2);
  } else {
    ctx.font = font(500, 11, colors.fontText);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = colors.plot;
    ctx.strokeText(unit.stage.label, unit.sx, top);
    ctx.fillStyle = labelColor(unit, colors);
    ctx.fillText(unit.stage.label, unit.sx, top);
  }
  ctx.restore();
}

function tooltipLines(frame: StageFrame, unit: PlacedUnit): string[] {
  const facts: string[] = [];
  const health = unit.stage.health && healthAt(unit.stage.health, frame.t);
  if (health && health.max > 0) facts.push(t('replay.tipHealth', { value: formatInteger(Math.round((health.current / health.max) * 100)) }));
  const selected = frame.selected === null ? undefined : frame.index.byActor.get(frame.selected);
  if (selected && selected !== unit.stage) {
    const at = placeUnit(selected, frame.t);
    if (at) facts.push(t('replay.tipDistance', { distance: formatFixed(Math.hypot(unit.x - at.x, unit.y - at.y), 1), name: selected.label }));
  }
  return facts.length > 0 ? [facts.join(' · ')] : [];
}

function drawTooltip(ctx: CanvasRenderingContext2D, frame: StageFrame, unit: PlacedUnit) {
  const { colors, w, h } = frame;
  const facts = tooltipLines(frame, unit);
  ctx.save();
  ctx.font = font(600, 13, colors.fontText);
  let width = ctx.measureText(unit.stage.label).width;
  ctx.font = font(400, 12, colors.fontText);
  for (const line of facts) width = Math.max(width, ctx.measureText(line).width);
  const boxW = width + 20;
  const boxH = 16 + 17 * (1 + facts.length);
  const left = Math.max(4, Math.min(unit.sx + 16, w - boxW - 4));
  const top = unit.sy + 18 + boxH > h - 4 ? Math.max(4, unit.sy - 18 - boxH) : unit.sy + 18;
  ctx.beginPath();
  ctx.roundRect(left + 0.5, top + 0.5, boxW, boxH, 8);
  ctx.fillStyle = colors.panelRaised;
  ctx.fill();
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = font(600, 13, colors.fontText);
  ctx.fillStyle = labelColor(unit, colors);
  ctx.fillText(unit.stage.label, left + 10, top + 8);
  ctx.font = font(400, 12, colors.fontText);
  ctx.fillStyle = colors.muted;
  facts.forEach((line, i) => ctx.fillText(line, left + 10, top + 8 + 17 * (i + 1)));
  ctx.restore();
}

/** One frame of the stage: grid and scale bar, world markers, units with their markers, names, the hover tooltip. */
export function drawStage(ctx: CanvasRenderingContext2D, frame: StageFrame) {
  drawGrid(ctx, frame);
  if (frame.layers.worldMarkers) drawWorldMarkers(ctx, frame);
  const rank = (unit: PlacedUnit) => {
    const actor = unit.stage.unit.actor;
    if (actor === frame.selected) return 3;
    if (frame.highlight?.has(actor)) return 2;
    return frame.highlight ? 0 : 1;
  };
  const ordered = [...frame.placed].sort((a, b) => rank(a) - rank(b));
  for (const unit of ordered) drawUnit(ctx, frame, unit);
  for (const unit of ordered) {
    if (frame.layers.names || unit.stage.unit.actor === frame.selected) drawName(ctx, frame, unit);
  }
  if (frame.hover) drawTooltip(ctx, frame, frame.hover);
}
