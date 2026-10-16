import type { PlayerRef, ReplayAura, ReplayCast, ReplayData, ReplayDeath, ReplayHealthTrack, ReplayRaidMarker, ReplayUnit } from '../../api/types';
import { t } from '../../i18n/i18n';
import { ROLE_ORDER, shortName } from '../overview/players';
import { healthAt } from './playback';
import { groupBy } from './stageDraw';

const MAX_ADD_FRAMES = 8;
const RAID_FRAME_DEBUFFS = 3;
const RAID_FRAME_BUFFS = 2;

export interface HudIndex {
  data: ReplayData;
  units: Map<number, ReplayUnit>;
  roster: Map<number, PlayerRef>;
  health: Map<number, ReplayHealthTrack>;
  /** By caster. */
  casts: Map<number, ReplayCast[]>;
  /** By caster, only casts with a cast time: an instant cast at the same moment must not hide a running one. */
  castBars: Map<number, ReplayCast[]>;
  /** By target. */
  auras: Map<number, ReplayAura[]>;
  deaths: Map<number, ReplayDeath[]>;
  raidMarkers: Map<number, ReplayRaidMarker[]>;
  positioned: Set<number>;
  bosses: ReplayUnit[];
  /** In order of first appearance. */
  adds: ReplayUnit[];
  /** By role, then name. */
  players: ReplayUnit[];
}

const roleRank = (player: PlayerRef | undefined) => ROLE_ORDER.indexOf(player?.role ?? null);

/** The bundle's per-unit lookups, built once so the HUD does not scan the whole bundle for every frame it draws. */
export function indexHud(data: ReplayData): HudIndex {
  const roster = new Map(data.roster.map((player) => [player.actorId, player]));
  const health = new Map(data.health.map((track) => [track.actor, track]));
  const tracks = new Map(data.tracks.map((track) => [track.actor, track]));
  const firstSeen = (unit: ReplayUnit) => Math.min(tracks.get(unit.actor)?.t[0] ?? Infinity, health.get(unit.actor)?.t[0] ?? Infinity);
  const adds = data.units
    .filter((unit) => unit.kind === 'add')
    .map((unit) => ({ unit, seen: firstSeen(unit) }))
    .sort((a, b) => a.seen - b.seen || a.unit.name.localeCompare(b.unit.name) || (a.unit.addNumber ?? 0) - (b.unit.addNumber ?? 0))
    .map(({ unit }) => unit);
  const players = data.units
    .filter((unit) => unit.kind === 'player')
    .sort((a, b) => roleRank(roster.get(a.actor)) - roleRank(roster.get(b.actor)) || shortName(a.name).localeCompare(shortName(b.name)));
  return {
    data,
    units: new Map(data.units.map((unit) => [unit.actor, unit])),
    roster,
    health,
    casts: groupBy(data.casts, (cast) => cast.caster),
    castBars: groupBy(
      data.casts.filter((cast) => cast.endMs > cast.startMs),
      (cast) => cast.caster,
    ),
    auras: groupBy(data.auras, (aura) => aura.target),
    deaths: groupBy(data.deaths, (death) => death.actor),
    raidMarkers: groupBy(data.raidMarkers, (marker) => marker.actor),
    positioned: new Set(tracks.keys()),
    bosses: data.units.filter((unit) => unit.kind === 'boss'),
    adds,
    players,
  };
}

/** A player's short name, an add with its number (`Clutch 3`), else the logged name. */
export function unitLabel(unit: ReplayUnit): string {
  if (unit.kind === 'player') return shortName(unit.name);
  if (unit.kind === 'add' && unit.addNumber !== null) return t('replay.addName', { name: unit.name, number: unit.addNumber });
  return unit.name;
}

export function isDeadAt(hud: HudIndex, actor: number, time: number): boolean {
  return (hud.deaths.get(actor) ?? []).some((death) => death.t <= time && (death.until === null || time < death.until));
}

/** Health at `time` as logged, with its share 0..100; `null` before the first sample. */
export function healthShareAt(hud: HudIndex, actor: number, time: number): { current: number; max: number; percent: number | null } | null {
  const track = hud.health.get(actor);
  const health = track && healthAt(track, time);
  if (!health) return null;
  return { ...health, percent: health.max > 0 ? (health.current / health.max) * 100 : null };
}

/** The boss frames at `time`: every boss, then the adds alive then up to the cap, and how many adds did not fit. */
export function bossFrameUnits(hud: HudIndex, time: number): { units: ReplayUnit[]; more: number } {
  const alive = hud.adds.filter((add) => healthShareAt(hud, add.actor, time) !== null && !isDeadAt(hud, add.actor, time));
  return { units: [...hud.bosses, ...alive.slice(0, MAX_ADD_FRAMES)], more: Math.max(0, alive.length - MAX_ADD_FRAMES) };
}

const byRaidFramePriority = (a: ReplayAura, b: ReplayAura) => (a.raidFrame ?? 0) - (b.raidFrame ?? 0) || b.startMs - a.startMs;

/** Which of the `active` auras a raid frame shows: its curated priority first, then the latest applied. */
export function raidFrameAuras(active: ReplayAura[]): { debuffs: ReplayAura[]; buffs: ReplayAura[] } {
  const shown = active.filter((aura) => aura.raidFrame !== null).sort(byRaidFramePriority);
  return {
    debuffs: shown.filter((aura) => !aura.buff).slice(0, RAID_FRAME_DEBUFFS),
    buffs: shown.filter((aura) => aura.buff).slice(0, RAID_FRAME_BUFFS),
  };
}

export function raidMarkerAt(hud: HudIndex, actor: number, time: number): number | null {
  return (hud.raidMarkers.get(actor) ?? []).find((marker) => marker.startMs <= time && time < marker.endMs)?.marker ?? null;
}
