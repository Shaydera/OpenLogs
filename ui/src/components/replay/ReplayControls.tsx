import { type KeyboardEvent, type PointerEvent, useEffect, useRef } from 'react';
import type { ReplayData } from '../../api/types';
import { formatEventTime } from '../../i18n/format';
import { type MessageKey, t } from '../../i18n/i18n';
import { type ReplayFilters, type ReplayLayers, type ReplaySpeed, type TimeRange, useApp } from '../../store';
import { shortName } from '../overview/players';
import { phaseLabels } from '../overview/timelineGeometry';
import { CutoffShade, cutoffRest } from '../reports/CutoffShade';
import { percentIn, timeAtX } from '../views/zoomGeometry';
import { replayClock } from './replayClock';

/** A mouse wheel notch (about 100 px) seeks one second. */
const WHEEL_MS_PER_PX = 10;
const LINE_PX = 16;
const PAGE_PX = 800;

const SPEEDS: { speed: ReplaySpeed; key: MessageKey }[] = [
  { speed: 0.5, key: 'replay.speedHalf' },
  { speed: 1, key: 'replay.speed1' },
  { speed: 2, key: 'replay.speed2' },
  { speed: 4, key: 'replay.speed4' },
];
const UNIT_FILTERS: { filter: keyof Omit<ReplayFilters, 'hidden'>; key: MessageKey }[] = [
  { filter: 'players', key: 'replay.players' },
  { filter: 'pets', key: 'replay.pets' },
  { filter: 'bosses', key: 'replay.bosses' },
  { filter: 'adds', key: 'replay.adds' },
];
const LAYERS: { layer: keyof ReplayLayers; key: MessageKey }[] = [
  { layer: 'map', key: 'replay.map' },
  { layer: 'grid', key: 'replay.grid' },
  { layer: 'effects', key: 'replay.effects' },
  { layer: 'worldMarkers', key: 'replay.worldMarkers' },
  { layer: 'facing', key: 'replay.facing' },
  { layer: 'names', key: 'replay.names' },
];

/** The replay's time now: the running clock while it plays (the store's time lags it by up to a tick). */
export function replayNow(): number {
  const { time, playing } = useApp.getState().replay;
  return playing ? replayClock.now() : time;
}

/**
 * The bar under the stage: the timeline over `bounds`, play/pause, the time, speeds, unit filters, layers and follow (`compact`: a hint
 * instead of the last three). Seeking ends at `limitMs`, the analysed end inside `bounds`.
 */
export function ReplayControls({ data, bounds, limitMs, compact = false }: { data: ReplayData; bounds: TimeRange; limitMs: number; compact?: boolean }) {
  const replay = useApp((s) => s.replay);
  const toggleReplayPlay = useApp((s) => s.toggleReplayPlay);
  const setReplaySpeed = useApp((s) => s.setReplaySpeed);
  const setReplayFilter = useApp((s) => s.setReplayFilter);
  const setReplayLayer = useApp((s) => s.setReplayLayer);
  const setReplayFollow = useApp((s) => s.setReplayFollow);
  const chip = (on: boolean) => (on ? 'replay-chip on' : 'replay-chip');

  return (
    <div className="replay-controls">
      <ReplayScrubber data={data} bounds={bounds} limitMs={limitMs} time={replay.time} />
      <div className="replay-bar">
        <button type="button" className="replay-play" aria-label={t(replay.playing ? 'replay.pause' : 'replay.play')} onClick={toggleReplayPlay}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            {replay.playing ? <path d="M3 1.5h3v11H3zM8 1.5h3v11H8z" /> : <path d="M3 1.5 L12 7 L3 12.5 Z" />}
          </svg>
        </button>
        <span className="num replay-time">
          {formatEventTime(replay.time)} <span className="replay-time-end">{t('replay.ofEnd', { end: formatEventTime(limitMs) })}</span>
        </span>
        <div className="replay-seg" role="group" aria-label={t('replay.speed')}>
          {SPEEDS.map(({ speed, key }) => (
            <button key={speed} type="button" className={speed === replay.speed ? 'on' : undefined} aria-pressed={speed === replay.speed} onClick={() => setReplaySpeed(speed)}>
              {t(key)}
            </button>
          ))}
        </div>
        {compact ? (
          <span className="replay-hint">{t('replay.compactHint')}</span>
        ) : (
          <>
            <div className="replay-chips" role="group" aria-label={t('replay.showUnits')}>
              <span className="cap" aria-hidden="true">
                {t('replay.show')}
              </span>
              {UNIT_FILTERS.map(({ filter, key }) => (
                <button key={filter} type="button" className={chip(replay.filters[filter])} aria-pressed={replay.filters[filter]} onClick={() => setReplayFilter({ [filter]: !replay.filters[filter] })}>
                  {t(key)}
                </button>
              ))}
            </div>
            <div className="replay-chips" role="group" aria-label={t('replay.layers')}>
              <span className="cap" aria-hidden="true">
                {t('replay.layers')}
              </span>
              {LAYERS.map(({ layer, key }) => (
                <button key={layer} type="button" className={chip(replay.layers[layer])} aria-pressed={replay.layers[layer]} onClick={() => setReplayLayer(layer, !replay.layers[layer])}>
                  {t(key)}
                </button>
              ))}
            </div>
            <button type="button" className={`${chip(replay.follow)} replay-follow`} aria-pressed={replay.follow} onClick={() => setReplayFollow(!replay.follow)}>
              {t('replay.follow')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** The pull's (or range's) timeline: phase bands, player deaths, the rest after the cut and the playhead. A click, a drag or the wheel seeks. */
function ReplayScrubber({ data, bounds, limitMs, time }: { data: ReplayData; bounds: TimeRange; limitMs: number; time: number }) {
  const setReplayTime = useApp((s) => s.setReplayTime);
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const { startMs, endMs } = bounds;

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      const unit = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? PAGE_PX : 1;
      const px = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * unit;
      const now = Math.round(replayNow());
      const next = Math.min(Math.max(Math.round(now + px * WHEEL_MS_PER_PX), startMs), limitMs);
      // At either end the wheel scrolls the page again.
      if (next === now) return;
      event.preventDefault();
      setReplayTime(next);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [startMs, limitMs, setReplayTime]);

  const seekAt = (element: HTMLElement, clientX: number) => {
    const box = element.getBoundingClientRect();
    setReplayTime(timeAtX(clientX - box.left, box.width, bounds));
  };

  function down(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    dragging.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    seekAt(event.currentTarget, event.clientX);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (dragging.current === event.pointerId) seekAt(event.currentTarget, event.clientX);
  }
  function release(event: PointerEvent<HTMLDivElement>) {
    if (dragging.current === event.pointerId) dragging.current = null;
  }
  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    setReplayTime(event.key === 'Home' ? startMs : limitMs);
  }

  const pct = (ms: number) => Math.min(100, Math.max(0, percentIn(ms, bounds)));
  const labels = phaseLabels(data.phases);
  const phases = data.phases.map((phase, i) => ({ phase, label: labels[i] })).filter(({ phase }) => phase.endMs > startMs && phase.startMs < endMs);
  const players = new Set(data.units.filter((unit) => unit.kind === 'player').map((unit) => unit.actor));
  const roster = new Map(data.roster.map((player) => [player.actorId, player]));
  const deaths = data.deaths.filter((death) => players.has(death.actor) && death.t >= startMs && death.t <= endMs);
  const played = pct(time);

  return (
    <div
      ref={track}
      className="replay-scrubber"
      role="slider"
      tabIndex={0}
      aria-label={t('replay.timeline')}
      aria-valuemin={startMs}
      aria-valuemax={limitMs}
      aria-valuenow={Math.round(time)}
      aria-valuetext={t('replay.timeOf', { time: formatEventTime(time), end: formatEventTime(limitMs) })}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={key}
    >
      {phases.map(({ phase, label }) => (
        <span
          key={`${phase.kind}-${phase.number}-${phase.startMs}`}
          className={`replay-phase replay-phase-${phase.kind}`}
          style={{ left: `${pct(phase.startMs)}%`, width: `${pct(phase.endMs) - pct(phase.startMs)}%` }}
          title={label}
        />
      ))}
      <span className="replay-played" style={{ width: `${played}%` }} />
      {deaths.map((death) => {
        const name = shortName(roster.get(death.actor)?.name ?? data.units.find((unit) => unit.actor === death.actor)?.name ?? '');
        return (
          <span
            key={`${death.actor}-${death.t}`}
            className="replay-death"
            style={{ left: `${pct(death.t)}%` }}
            title={t('replay.died', { name, time: formatEventTime(death.t) })}
          />
        );
      })}
      {limitMs < endMs && <CutoffShade cutoffMs={limitMs - startMs} durationMs={endMs - startMs} rest={cutoffRest(limitMs, endMs)} />}
      <span className="replay-playhead" style={{ left: `${played}%` }} />
    </div>
  );
}
