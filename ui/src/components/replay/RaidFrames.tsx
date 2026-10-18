import type { MouseEvent } from 'react';
import type { ReplayUnit } from '../../api/types';
import { type MessageKey, t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { classColor } from '../overview/players';
import { AuraIcons } from './AuraIcons';
import { type HudIndex, healthShareAt, isDeadAt, raidFrameAuras, raidMarkerAt, unitLabel } from './hudIndex';
import { HudPanel } from './HudParts';
import { aurasAt } from './playback';
import { useReplayTime } from './useReplayTime';
import { MARKER_SYMBOLS, type MarkerSymbol, RAID_TARGET_MARKERS, markerColorVar, symbolPath } from './worldMarkers';

const AURA_PX = 14;
const MARKER_PX = 12;

const MARKER_NAMES: Record<MarkerSymbol, MessageKey> = {
  star: 'replay.markerStar',
  circle: 'replay.markerCircle',
  diamond: 'replay.markerDiamond',
  triangle: 'replay.markerTriangle',
  moon: 'replay.markerMoon',
  square: 'replay.markerSquare',
  cross: 'replay.markerCross',
  skull: 'replay.markerSkull',
};

const MARKER_PATHS = Object.fromEntries(MARKER_SYMBOLS.map((symbol) => [symbol, symbolPath(symbol)])) as Record<MarkerSymbol, string>;

function RaidMarker({ marker }: { marker: number }) {
  const look = RAID_TARGET_MARKERS[marker];
  if (!look) return null;
  return (
    <svg className="hud-raid-marker" width={MARKER_PX} height={MARKER_PX} viewBox="-8 -8 16 16" role="img" aria-label={t(MARKER_NAMES[look.symbol])}>
      <path d={MARKER_PATHS[look.symbol]} style={{ fill: `var(${markerColorVar(look.symbol)})` }} />
    </svg>
  );
}

interface RaidFrameProps {
  hud: HudIndex;
  unit: ReplayUnit;
  time: number;
  selected: boolean;
  onSelect: () => void;
}

function RaidFrame({ hud, unit, time, selected, onSelect }: RaidFrameProps) {
  const name = unitLabel(unit);
  const dead = isDeadAt(hud, unit.actor, time);
  const health = healthShareAt(hud, unit.actor, time);
  const fill = dead ? 0 : Math.min(100, Math.max(0, health?.percent ?? 0));
  const marker = raidMarkerAt(hud, unit.actor, time);
  const { debuffs, buffs } = raidFrameAuras(aurasAt(hud.auras.get(unit.actor) ?? [], unit.actor, time));
  const status = [dead ? t('replay.dead') : null, hud.positioned.has(unit.actor) ? null : t('replay.noPosition')].filter((text) => text !== null);
  const color = dead ? undefined : classColor(hud.roster.get(unit.actor)?.classToken ?? null);
  const classes = ['hud-raid-frame', selected ? 'on' : '', dead ? 'dead' : ''].filter(Boolean).join(' ');
  const selectOnMouseClick = (event: MouseEvent) => {
    if ((event.nativeEvent as PointerEvent).pointerType !== 'touch') onSelect();
  };
  return (
    <div role="group" aria-label={name} className={classes}>
      <span className="hud-raid-fill" style={{ width: `${fill}%` }} aria-hidden="true" />
      <div className="hud-raid-head">
        <button type="button" className="hud-raid-select" aria-pressed={selected} onClick={onSelect}>
          <span style={{ color }}>{name}</span>
        </button>
        {marker !== null && <RaidMarker marker={marker} />}
      </div>
      {status.length > 0 && <span className="hud-raid-status">{status.join(t('replay.separator'))}</span>}
      {/* The icons take the pointer for their tooltips, so a mouse click on one is forwarded; a tap opens its tooltip. */}
      <div className="hud-raid-auras" onClick={selectOnMouseClick}>
        <div>
          <AuraIcons hud={hud} auras={debuffs} time={time} label={t('replay.debuffs')} size={AURA_PX} />
        </div>
        <div>
          <AuraIcons hud={hud} auras={buffs} time={time} label={t('replay.buffs')} size={AURA_PX} />
        </div>
      </div>
    </div>
  );
}

/** Bottom left: the players by role and name in five columns; a click selects one, a second click clears it. */
export function RaidFrames({ hud, defaultCollapsed = false }: { hud: HudIndex; defaultCollapsed?: boolean }) {
  const time = useReplayTime();
  const selected = useApp((s) => s.replay.selected);
  const selectReplayUnit = useApp((s) => s.selectReplayUnit);
  if (hud.players.length === 0) return null;
  return (
    <HudPanel label={t('replay.raidFrames')} className="hud-raid" defaultCollapsed={defaultCollapsed}>
      <div className="hud-raid-grid">
        {hud.players.map((unit) => (
          <RaidFrame key={unit.actor} hud={hud} unit={unit} time={time} selected={unit.actor === selected} onSelect={() => selectReplayUnit(unit.actor === selected ? null : unit.actor)} />
        ))}
      </div>
    </HudPanel>
  );
}
