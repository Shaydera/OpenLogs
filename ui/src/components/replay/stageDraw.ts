import type { EffectInstance, MapArtTable, ReplayData, ReplayDeath, ReplayHealthTrack, ReplayRaidMarker, ReplayTrack, ReplayUnit, ReplayWorldMarker } from '../../api/types';
import { formatFixed, formatInteger, formatSpan, formatYards } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { type IconRef, bossIcon, classIcon, specIcon } from '../../icons';
import { bossMonogram, initials } from '../../monogram';
import type { ReplayFilters, ReplayLayers } from '../../store';
import { shortName } from '../overview/players';
import { type Bounds, type Camera, facingOnScreen, gridStep, toScreen, toWorld } from './camera';
import type { EffectState } from './effects';
import { type MapBoundsYd, type StageMap, stageMap } from './mapArt';
import { UNKNOWN_MAP, deathAt, floorAt, goneAfterMs, groupBy, healthAt, placementAt } from './playback';
import type { StageColors } from './stageColors';
import { type MarkerLook, RAID_TARGET_MARKERS, WORLD_MARKERS, traceSymbol } from './worldMarkers';

export const STAGE_PAD_PX = 40;
/** The HUD captions along the stage top: 14 px in from the edge, 24 px high (the `.hud-toggle` of `.hud-meter` and `.hud-bosses`). */
export const HUD_CAPTION_ROW_PX = 14 + 24;
const HIT_PX = 14;
const UNIT_PX: Record<ReplayUnit['kind'], number> = { player: 22, pet: 16, boss: 28, add: 22 };
const WORLD_MARKER_PX = 26;
const EFFECT_FILL_ALPHA = 0.1;
const EFFECT_RING_GAP_PX = 4;
const MAX_EFFECT_RINGS = 3;
const EFFECT_LABEL_PX = 12;
const EFFECT_LABEL_GAP_PX = 6;
const EFFECT_LABEL_PAD_PX = 4;
const KIND_FILTER: Record<ReplayUnit['kind'], keyof Omit<ReplayFilters, 'hidden'>> = { player: 'players', pet: 'pets', boss: 'bosses', add: 'adds' };

export interface StageUnit {
  unit: ReplayUnit;
  track: ReplayTrack;
  /** Sorted by `t`. */
  deaths: ReplayDeath[];
  raidMarkers: ReplayRaidMarker[];
  health: ReplayHealthTrack | undefined;
  goneAfterMs: number;
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
  stageMap: StageMap;
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

/** The bundle's per-unit lookups and its floor, built once so the stage does not scan the whole bundle every frame. */
export function indexStage(data: ReplayData, mapArt: MapArtTable | null): StageIndex {
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
      goneAfterMs: goneAfterMs(unit.kind, track, health.get(unit.actor)),
      classKey: classTokens.get(unit.kind === 'pet' ? (unit.owner ?? -1) : unit.actor) ?? null,
      label,
      icon: unitIcon(unit, data.encounterId),
      monogram: unit.kind === 'boss' ? bossMonogram(label) : unit.kind === 'player' ? label.slice(0, 2) : initials(label).toUpperCase(),
    });
  }
  return {
    units,
    byActor: new Map(units.map((stage) => [stage.unit.actor, stage])),
    worldMarkers: data.worldMarkers,
    bounds: stageBounds(data),
    stageMap: stageMap(data, mapArt),
  };
}

/** Where `stage` is at `t`, with the death that may hold it in place; `null` before its first sample and once it is gone. */
export function placeUnit(stage: StageUnit, t: number) {
  return t > stage.goneAfterMs ? null : placementAt(stage.track, t, deathAt(stage.deaths, t));
}

/** Whether `stage` is at `t` on a known floor other than the one the stage shows, and so is not drawn. */
export function onOtherFloor(index: StageIndex, stage: StageUnit, t: number): boolean {
  const shownFloor = index.stageMap.uiMapId;
  if (shownFloor === null) return false;
  const floor = floorAt(stage.track, t, deathAt(stage.deaths, t));
  return floor !== UNKNOWN_MAP && floor !== shownFloor;
}

/** `states` without the effects anchored to a unit on another floor. */
export function effectsOnStage(index: StageIndex, states: EffectState[], t: number): EffectState[] {
  return states.filter(({ effect: { anchor } }) => {
    const anchorUnit = anchor?.type === 'unit' ? index.byActor.get(anchor.actor) : undefined;
    return !anchorUnit || !onOtherFloor(index, anchorUnit, t);
  });
}

/** The units `filters` shows at `t` with their screen positions, and those it would show but are on another floor than the stage. */
export function placeUnits(index: StageIndex, t: number, filters: ReplayFilters, cam: Camera, w: number, h: number): { placed: PlacedUnit[]; otherFloor: StageUnit[] } {
  const hidden = new Set(filters.hidden);
  const placed: PlacedUnit[] = [];
  const otherFloor: StageUnit[] = [];
  for (const stage of index.units) {
    if (!filters[KIND_FILTER[stage.unit.kind]] || hidden.has(stage.unit.actor)) continue;
    const at = placeUnit(stage, t);
    if (!at) continue;
    if (onOtherFloor(index, stage, t)) {
      otherFloor.push(stage);
      continue;
    }
    const [sx, sy] = toScreen(cam, at.x, at.y, w, h);
    placed.push({ stage, ...at, sx, sy });
  }
  return { placed, otherFloor };
}

type ScreenPoint = [x: number, y: number];

/** Where a map image with `bounds` lands on screen: its top-left corner and the screen vectors along its top and left edges. */
export function mapArtOnScreen(cam: Camera, bounds: MapBoundsYd, w: number, h: number): { origin: ScreenPoint; right: ScreenPoint; down: ScreenPoint } {
  const origin = toScreen(cam, bounds.maxX, bounds.maxY, w, h);
  const topRight = toScreen(cam, bounds.maxX, bounds.minY, w, h);
  const bottomLeft = toScreen(cam, bounds.minX, bounds.maxY, w, h);
  return { origin, right: [topRight[0] - origin[0], topRight[1] - origin[1]], down: [bottomLeft[0] - origin[0], bottomLeft[1] - origin[1]] };
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

/** Whether the image at `src` was asked for through `stageImage` and failed to load. */
export function stageImageFailed(src: string): boolean {
  const image = images.get(src);
  return image !== undefined && image.complete && image.naturalWidth === 0;
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
  /** The effects up at `t`; empty while the effects layer is off. */
  effects: EffectState[];
  /** The effect picked in the effect list, drawn with a thicker outline. */
  selectedEffect: EffectInstance | null;
  /** The loaded image of an icon ref, else `null`. */
  image: (icon: IconRef) => HTMLImageElement | null;
  /** The loaded map image of the shown floor while the map layer is on, else `null`. */
  mapArt: HTMLImageElement | null;
}

const font = (weight: number, px: number, family: string) => `${weight} ${px}px ${family}`;

/** The map image placed by its floor's bounds, under a veil in the plot colour so units and effects keep their contrast. */
function drawMapArt(ctx: CanvasRenderingContext2D, { w, h, cam, colors, index }: StageFrame, image: HTMLImageElement): boolean {
  const { bounds } = index.stageMap;
  if (!bounds) return false;
  const { origin, right, down } = mapArtOnScreen(cam, bounds, w, h);
  ctx.save();
  ctx.transform(right[0] / image.naturalWidth, right[1] / image.naturalWidth, down[0] / image.naturalHeight, down[1] / image.naturalHeight, origin[0], origin[1]);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
  ctx.save();
  ctx.fillStyle = colors.mapDim;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  return true;
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
}

function drawScaleBar(ctx: CanvasRenderingContext2D, { h, cam, colors }: StageFrame) {
  const step = gridStep(cam.scale);
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

function effectLabel(effect: EffectInstance): string {
  const values = { name: effect.name, radius: formatYards(effect.radiusYd) };
  return effect.estimated ? t('replay.effectAreaEstimated', values) : t('replay.effectArea', values);
}

/** Where the label of a circle around (`sx`, `sy`) goes: centred above it, but kept on the stage below the HUD captions while any of the circle is. */
export function effectLabelAt(sx: number, sy: number, r: number, labelW: number, w: number, h: number): [x: number, bottom: number] {
  const above = sy - r - EFFECT_LABEL_GAP_PX;
  const onStage = sx + r >= 0 && sx - r <= w && sy + r >= 0 && sy - r <= h;
  if (!onStage) return [sx, above];
  const half = labelW / 2 + EFFECT_LABEL_PAD_PX;
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
  return [clamp(sx, half, w - half), clamp(above, HUD_CAPTION_ROW_PX + EFFECT_LABEL_PAD_PX + EFFECT_LABEL_PX, h - EFFECT_LABEL_PAD_PX)];
}

/** A circle in the effect's colour with its name and radius above. */
function drawEffectArea(ctx: CanvasRenderingContext2D, frame: StageFrame, state: EffectState) {
  const { effect, center } = state;
  if (!center) return;
  const { colors, cam, w, h } = frame;
  const [sx, sy] = toScreen(cam, center.x, center.y, w, h);
  const color = colors.effects[effect.category];
  const r = effect.radiusYd * cam.scale;
  ctx.save();
  ctx.globalAlpha = center.stale ? 0.5 : 1;
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, 2 * Math.PI);
  ctx.save();
  ctx.globalAlpha *= EFFECT_FILL_ALPHA;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
  ctx.setLineDash(effect.estimated ? [6, 4] : []);
  ctx.strokeStyle = color;
  ctx.lineWidth = effect === frame.selectedEffect ? 4 : 2;
  ctx.stroke();
  ctx.setLineDash([]);
  const label = effectLabel(effect);
  ctx.font = font(600, EFFECT_LABEL_PX, colors.fontText);
  const [labelX, labelY] = effectLabelAt(sx, sy, r, ctx.measureText(label).width, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = colors.plot;
  ctx.strokeText(label, labelX, labelY);
  ctx.fillStyle = color;
  ctx.fillText(label, labelX, labelY);
  ctx.restore();
}

/**
 * Rings around the players of each drawn effect: solid in its colour where the log shows it reached them, dashed where it
 * is missing. The effect picked in the list gets the innermost, thicker rings and the others' rings fade.
 */
function drawEffectRings(ctx: CanvasRenderingContext2D, frame: StageFrame, units: PlacedUnit[], drawn: EffectState[]) {
  const { colors, selected, highlight, selectedEffect } = frame;
  const byActor = new Map(units.map((unit) => [unit.stage.unit.actor, unit]));
  const ringCount = new Map<number, number>();
  const anyPicked = drawn.some((state) => state.effect === selectedEffect);
  const ring = (actor: number, color: string, dashed: boolean, picked: boolean) => {
    const unit = byActor.get(actor);
    const slot = ringCount.get(actor) ?? 0;
    if (!unit || slot >= MAX_EFFECT_RINGS) return;
    ringCount.set(actor, slot + 1);
    const emphasized = actor === selected || (highlight?.has(actor) ?? false);
    const r = UNIT_PX[unit.stage.unit.kind] / 2 + (emphasized ? 10 : 4) + slot * EFFECT_RING_GAP_PX;
    ctx.save();
    ctx.globalAlpha = (unit.stale ? 0.5 : 1) * (highlight && !emphasized ? 0.35 : 1) * (anyPicked && !picked ? 0.35 : 1);
    ctx.beginPath();
    ctx.arc(unit.sx, unit.sy, r, 0, 2 * Math.PI);
    ctx.setLineDash(dashed ? [4, 3] : []);
    ctx.strokeStyle = color;
    ctx.lineWidth = picked ? 3 : 2;
    ctx.stroke();
    ctx.restore();
  };
  const pickedFirst = [...drawn].sort((a, b) => Number(b.effect === selectedEffect) - Number(a.effect === selectedEffect));
  for (const state of pickedFirst) {
    const picked = state.effect === selectedEffect;
    for (const actor of state.affected) ring(actor, colors.effects[state.effect.category], false, picked);
    for (const actor of state.missing) ring(actor, colors.effectMissing, true, picked);
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

type TipLine = { text: string; color: string };

function missingLine(effect: EffectInstance): string {
  return effect.category === 'heal' ? t('replay.effectNoHeal', { name: effect.name, window: formatSpan(effect.tickWindowMs) }) : t('replay.effectNotLogged', { name: effect.name });
}

function tooltipLines(frame: StageFrame, unit: PlacedUnit): TipLine[] {
  const facts: string[] = [];
  const health = unit.stage.health && healthAt(unit.stage.health, frame.t);
  if (health && health.max > 0) facts.push(t('replay.tipHealth', { value: formatInteger(Math.round((health.current / health.max) * 100)) }));
  const selected = frame.selected === null ? undefined : frame.index.byActor.get(frame.selected);
  if (selected && selected !== unit.stage && !onOtherFloor(frame.index, selected, frame.t)) {
    const at = placeUnit(selected, frame.t);
    if (at) facts.push(t('replay.tipDistance', { distance: formatFixed(Math.hypot(unit.x - at.x, unit.y - at.y), 1), name: selected.label }));
  }
  const lines = facts.length > 0 ? [{ text: facts.join(' · '), color: frame.colors.muted }] : [];
  for (const state of frame.effects) {
    if (state.center && state.missing.includes(unit.stage.unit.actor)) lines.push({ text: missingLine(state.effect), color: frame.colors.effectMissing });
  }
  return lines;
}

function drawTooltip(ctx: CanvasRenderingContext2D, frame: StageFrame, unit: PlacedUnit) {
  const { colors, w, h } = frame;
  const lines = tooltipLines(frame, unit);
  ctx.save();
  ctx.font = font(600, 13, colors.fontText);
  let width = ctx.measureText(unit.stage.label).width;
  ctx.font = font(400, 12, colors.fontText);
  for (const line of lines) width = Math.max(width, ctx.measureText(line.text).width);
  const boxW = width + 20;
  const boxH = 16 + 17 * (1 + lines.length);
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
  lines.forEach((line, i) => {
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, left + 10, top + 8 + 17 * (i + 1));
  });
  ctx.restore();
}

/**
 * One frame of the stage: map image (the grid without one, or when its layer is on) and scale bar, world markers, effect
 * areas, units with their markers, effect rings, names, the hover tooltip.
 */
export function drawStage(ctx: CanvasRenderingContext2D, frame: StageFrame) {
  const artShown = frame.mapArt !== null && drawMapArt(ctx, frame, frame.mapArt);
  if (frame.layers.grid || !artShown) drawGrid(ctx, frame);
  drawScaleBar(ctx, frame);
  if (frame.layers.worldMarkers) drawWorldMarkers(ctx, frame);
  const drawn = frame.effects.filter((state) => state.center !== null);
  const picked = (state: EffectState) => (state.effect === frame.selectedEffect ? 1 : 0);
  for (const state of [...drawn].sort((a, b) => picked(a) - picked(b))) drawEffectArea(ctx, frame, state);
  const rank = (unit: PlacedUnit) => {
    const actor = unit.stage.unit.actor;
    if (actor === frame.selected) return 3;
    if (frame.highlight?.has(actor)) return 2;
    return frame.highlight ? 0 : 1;
  };
  const ordered = [...frame.placed].sort((a, b) => rank(a) - rank(b));
  for (const unit of ordered) drawUnit(ctx, frame, unit);
  drawEffectRings(ctx, frame, ordered, drawn);
  for (const unit of ordered) {
    if (frame.layers.names || unit.stage.unit.actor === frame.selected) drawName(ctx, frame, unit);
  }
  if (frame.hover) drawTooltip(ctx, frame, frame.hover);
}
