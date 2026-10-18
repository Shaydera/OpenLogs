import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EffectInstance, ReplayData } from '../../api/types';
import { t } from '../../i18n/i18n';
import { replaySplitShown, useApp } from '../../store';
import { rangeWindow } from '../views/zoomGeometry';
import { BossFrames } from './BossFrames';
import { EffectList } from './EffectList';
import { indexHud } from './hudIndex';
import { Meter } from './Meter';
import { RaidFrames } from './RaidFrames';
import { ReplayControls, replayNow } from './ReplayControls';
import { ReplayLegend } from './ReplayLegend';
import { ReplayStage } from './ReplayStage';
import { UnitFrames } from './UnitFrames';

const JUMP_MS = 5_000;
/** Below this stage height the raid frames start collapsed, so the meter keeps a usable height. */
const SHORT_STAGE_PX = 560;
/** The stage width below which the unit frames stack above the raid frames (the `.hud-bottom` container query). */
const NARROW_STAGE_PX = 1160;
/** Below this stage height the HUD takes its dense sizes (`data-dense`). */
const DENSE_STAGE_PX = 800;

type StageFit = { short: boolean; shortAndNarrow: boolean };

/** Whether the stage is short enough for the dense HUD, measured whenever the stage resizes. */
function useDenseStage(plot: RefObject<HTMLDivElement | null>): boolean {
  const [dense, setDense] = useState(false);
  useLayoutEffect(() => {
    const element = plot.current;
    if (!element) return;
    const measure = () => {
      const { height } = element.getBoundingClientRect();
      setDense(height > 0 && height < DENSE_STAGE_PX);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [plot]);
  return dense;
}

/**
 * The pull's replay: the strip with `rangePanel` and the legend, stage and controls; loads its bundle on first show. `compact` is the
 * split pane: no legend, filters or layers. Leaving it pauses playback unless the split still shows the replay.
 */
export function ReplayTab({ compact = false, rangePanel }: { compact?: boolean; rangePanel?: ReactNode }) {
  const data = useApp((s) => s.replayData);
  const error = useApp((s) => s.replayError);
  const loadReplay = useApp((s) => s.loadReplay);

  useEffect(() => {
    if (!data && !error) void loadReplay();
  }, [data, error, loadReplay]);

  useEffect(
    () => () => {
      const state = useApp.getState();
      if (state.replay.playing && !replaySplitShown(state)) state.toggleReplayPlay();
    },
    [],
  );

  if (data?.advancedLogging && !error) return <ReplayPanel data={data} compact={compact} rangePanel={rangePanel} />;
  return (
    <>
      {rangePanel && <div className="replay-strip">{rangePanel}</div>}
      {error ? (
        <p className="muted pad" role="alert">
          {t('replay.failed', { reason: error })}{' '}
          <button type="button" className="lnk" onClick={() => void loadReplay()}>
            {t('replay.retry')}
          </button>
        </p>
      ) : !data ? (
        <p className="muted pad">{t('replay.loading')}</p>
      ) : (
        <section className="panel replay-notice">
          <h2>{t('replay.noPositions')}</h2>
          <p>{t('replay.noPositionsHint')}</p>
        </section>
      )}
    </>
  );
}

function ReplayPanel({ data, compact, rangePanel }: { data: ReplayData; compact: boolean; rangePanel: ReactNode }) {
  const range = useApp((s) => s.range);
  const setReplayTime = useApp((s) => s.setReplayTime);
  const toggleReplayPlay = useApp((s) => s.toggleReplayPlay);
  const [highlight, setHighlight] = useState<number[] | null>(null);
  const [selectedEffect, setSelectedEffect] = useState<EffectInstance | null>(null);
  const hud = useMemo(() => indexHud(data), [data]);
  const plot = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<StageFit | null>(null);
  const dense = useDenseStage(plot);
  const bounds = rangeWindow(range, data.durationMs);
  const { startMs, endMs } = bounds;

  useLayoutEffect(() => {
    const { width, height } = plot.current?.getBoundingClientRect() ?? { width: 0, height: 0 };
    // A stage that is not laid out yet has no height to fit.
    const short = height > 0 && height < SHORT_STAGE_PX;
    setFit({ short, shortAndNarrow: short && width <= NARROW_STAGE_PX });
  }, []);

  useEffect(() => {
    const { time } = useApp.getState().replay;
    if (time < startMs || time > endMs) setReplayTime(time);
  }, [startMs, endMs, setReplayTime]);

  function onKey(event: KeyboardEvent<HTMLElement>) {
    if (event.ctrlKey || event.altKey || event.metaKey || event.target instanceof HTMLSelectElement) return;
    if (event.key === ' ') {
      // Space on a button inside the region presses that button.
      if (event.target instanceof HTMLButtonElement) return;
      event.preventDefault();
      if (!event.repeat) toggleReplayPlay();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      setReplayTime(replayNow() + (event.key === 'ArrowRight' ? JUMP_MS : -JUMP_MS));
    }
  }

  return (
    <>
      {!compact && (
        <div className="replay-strip">
          {rangePanel}
          <ReplayLegend data={data} highlight={highlight} onHighlight={setHighlight} />
        </div>
      )}
      <section
        className={compact ? 'panel replay replay-compact' : 'panel replay'}
        aria-label={t('replay.region')}
        data-dense={dense || undefined}
        tabIndex={0}
        onKeyDown={onKey}
      >
        <div className="replay-plot" ref={plot}>
          <ReplayStage data={data} highlight={highlight} selectedEffect={selectedEffect} />
          {fit && (
            <div className="hud-layout">
              <Meter hud={hud} bounds={bounds} defaultCollapsed={compact} />
              <div className="hud-side">
                <BossFrames hud={hud} />
                <EffectList hud={hud} selected={selectedEffect} onSelect={setSelectedEffect} defaultCollapsed={compact} />
              </div>
              <div className="hud-bottom">
                <RaidFrames hud={hud} defaultCollapsed={compact || fit.short} />
                <UnitFrames hud={hud} defaultCollapsed={compact || fit.shortAndNarrow} />
              </div>
            </div>
          )}
        </div>
        <ReplayControls data={data} bounds={bounds} compact={compact} />
      </section>
    </>
  );
}
