import type { MapArtTable, ReplayData } from '../../api/types';
import type { Bounds } from './camera';
import { UNKNOWN_MAP, deathAt, groupBy, isDeadAt } from './playback';

/** Side of the square the stage opens on around a boss pin. */
export const ARENA_SIZE_YD = 110;
/** Below this share of the pull's player samples the pin's floor is not shown. */
export const PIN_SHARE_MIN = 0.5;
const TRIM_SHARE = 0.05;
const MAP_IMAGE_BASE = 'https://wow.zamimg.com/images/wow/maps/enus/original/';

export type MapBoundsYd = { minX: number; maxX: number; minY: number; maxY: number };
export type StageMap = {
  /** `null`: the bundle holds no floor data. */
  uiMapId: number | null;
  /** The log's bounds, else the exported ones. */
  bounds: MapBoundsYd | null;
  /** The opening view in world yards. */
  frame: Bounds | null;
  /** Only for raid maps. */
  imageUrl: string | null;
};

function playerActors(data: ReplayData): Set<number> {
  return new Set(data.units.filter((unit) => unit.kind === 'player').map((unit) => unit.actor));
}

function playerSamplesPerFloor(data: ReplayData): Map<number, number> {
  const players = playerActors(data);
  const counts = new Map<number, number>();
  for (const track of data.tracks) {
    if (!players.has(track.actor)) continue;
    track.t.forEach((t, i) => {
      const map = track.map[i];
      if (t >= 0 && map !== UNKNOWN_MAP) counts.set(map, (counts.get(map) ?? 0) + 1);
    });
  }
  return counts;
}

/** The arena frame correction's floor, else the pin's, unless it holds less than `PIN_SHARE_MIN` of the pull's player samples; then the floor holding most of them. */
export function shownFloor(data: ReplayData, table: MapArtTable | null): number | null {
  const counts = playerSamplesPerFloor(data);
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;
  const preferred = data.arenaFrame?.uiMapId ?? table?.pins[data.encounterId]?.uiMapId;
  if (preferred !== undefined && (counts.get(preferred) ?? 0) / total >= PIN_SHARE_MIN) return preferred;
  let majority: [number, number] | null = null;
  for (const [map, count] of counts) {
    if (!majority || count > majority[1] || (count === majority[1] && map < majority[0])) majority = [map, count];
  }
  return majority?.[0] ?? null;
}

export function pinToWorld(pin: { u: number; v: number }, b: MapBoundsYd): { x: number; y: number } {
  return { x: b.maxX - pin.v * (b.maxX - b.minX), y: b.maxY - pin.u * (b.maxY - b.minY) };
}

function trimmedSpan(values: number[]): [number, number] {
  const sorted = [...values].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * TRIM_SHARE);
  return [sorted[cut], sorted[sorted.length - 1 - cut]];
}

type Point = { x: number; y: number };

function livingPlayerPositions(data: ReplayData, uiMapId: number | null): Point[] {
  const players = playerActors(data);
  const deaths = groupBy(data.deaths, (death) => death.actor);
  const positions: Point[] = [];
  for (const track of data.tracks) {
    if (!players.has(track.actor)) continue;
    const ownDeaths = deaths.get(track.actor) ?? [];
    track.t.forEach((t, i) => {
      if (t < 0 || (uiMapId !== null && track.map[i] !== uiMapId) || isDeadAt(deathAt(ownDeaths, t), t)) return;
      positions.push({ x: track.x[i], y: track.y[i] });
    });
  }
  return positions;
}

function boundsOfTrimmed(positions: Point[]): Bounds | null {
  if (positions.length === 0) return null;
  const [minX, maxX] = trimmedSpan(positions.map((p) => p.x));
  const [minY, maxY] = trimmedSpan(positions.map((p) => p.y));
  return { minX, maxX, minY, maxY };
}

const contains = (b: Bounds, p: Point) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

/** The extent of the living players' samples from the pull start on `uiMapId` (any floor when `null`), the outermost few cut off. */
export function robustBounds(data: ReplayData, uiMapId: number | null): Bounds | null {
  return boundsOfTrimmed(livingPlayerPositions(data, uiMapId));
}

export function mapImageUrl(entry: { zone: number; floor: number | null }): string {
  return `${MAP_IMAGE_BASE}${entry.floor === null ? entry.zone : `${entry.zone}-${entry.floor}`}.jpg`;
}

function squareAround(x: number, y: number, size: number): Bounds {
  return { minX: x - size / 2, maxX: x + size / 2, minY: y - size / 2, maxY: y + size / 2 };
}

function mapBounds(data: ReplayData, table: MapArtTable | null, uiMapId: number): MapBoundsYd | null {
  const source = data.maps.find((map) => map.uiMapId === uiMapId) ?? table?.maps[uiMapId];
  return source ? { minX: source.minX, maxX: source.maxX, minY: source.minY, maxY: source.maxY } : null;
}

function openingFrame(data: ReplayData, table: MapArtTable | null, uiMapId: number | null, bounds: MapBoundsYd | null): Bounds | null {
  const arena = data.arenaFrame;
  if (arena && uiMapId !== null && arena.uiMapId === uiMapId) return squareAround(arena.x, arena.y, arena.sizeYd);
  const positions = livingPlayerPositions(data, uiMapId);
  const fit = boundsOfTrimmed(positions);
  const pin = table?.pins[data.encounterId];
  if (pin && uiMapId !== null && pin.uiMapId === uiMapId && bounds) {
    const centre = pinToWorld(pin, bounds);
    const arenaAtPin = squareAround(centre.x, centre.y, ARENA_SIZE_YD);
    const pinMissesThePull = fit !== null && !positions.some((p) => contains(fit, p) && contains(arenaAtPin, p));
    if (!pinMissesThePull) return arenaAtPin;
  }
  return fit;
}

export function stageMap(data: ReplayData, table: MapArtTable | null): StageMap {
  const uiMapId = shownFloor(data, table);
  const bounds = uiMapId === null ? null : mapBounds(data, table, uiMapId);
  const entry = uiMapId === null ? undefined : table?.maps[uiMapId];
  return {
    uiMapId,
    bounds,
    frame: openingFrame(data, table, uiMapId, bounds),
    imageUrl: entry?.raid && bounds ? mapImageUrl(entry) : null,
  };
}
