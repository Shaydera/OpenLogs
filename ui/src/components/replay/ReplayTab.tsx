import { type KeyboardEvent, useEffect, useMemo, useState } from 'react';
import type { EffectInstance, ReplayData } from '../../api/types';
import { t } from '../../i18n/i18n';
import { replaySplitShown, useApp } from '../../store';
import { rangeWindow } from '../views/zoomGeometry';
import { BossFrames } from './BossFrames';
import { EffectList } from './EffectList';
import { indexHud } from './hudIndex';
import { RaidFrames } from './RaidFrames';
import { ReplayControls, replayNow } from './ReplayControls';
import { ReplayLegend } from './ReplayLegend';
import { ReplayStage } from './ReplayStage';
import { UnitFrame } from './UnitFrame';

const JUMP_MS = 5_000;

/**
 * The pull's replay: legend, stage and controls; loads its bundle on first show. `compact` is the split pane: no legend, filters or layers.
 * Leaving it pauses playback unless the split still shows the replay.
 */
export function ReplayTab({ compact = false }: { compact?: boolean }) {
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

  if (error)
    return (
      <p className="muted pad" role="alert">
        {t('replay.failed', { reason: error })}{' '}
        <button type="button" className="lnk" onClick={() => void loadReplay()}>
          {t('replay.retry')}
        </button>
      </p>
    );
  if (!data) return <p className="muted pad">{t('replay.loading')}</p>;
  if (!data.advancedLogging)
    return (
      <section className="panel replay-notice">
        <h2>{t('replay.noPositions')}</h2>
        <p>{t('replay.noPositionsHint')}</p>
      </section>
    );
  return <ReplayPanel data={data} compact={compact} />;
}

function ReplayPanel({ data, compact }: { data: ReplayData; compact: boolean }) {
  const range = useApp((s) => s.range);
  const setReplayTime = useApp((s) => s.setReplayTime);
  const toggleReplayPlay = useApp((s) => s.toggleReplayPlay);
  const [highlight, setHighlight] = useState<number[] | null>(null);
  const [selectedEffect, setSelectedEffect] = useState<EffectInstance | null>(null);
  const hud = useMemo(() => indexHud(data), [data]);
  const bounds = rangeWindow(range, data.durationMs);
  const { startMs, endMs } = bounds;

  useEffect(() => {
    const { time } = useApp.getState().replay;
    if (time < startMs || time > endMs) setReplayTime(time);
  }, [startMs, endMs, setReplayTime]);

  function onKey(event: KeyboardEvent<HTMLElement>) {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
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
    <section className={compact ? 'panel replay replay-compact' : 'panel replay'} aria-label={t('replay.region')} tabIndex={0} onKeyDown={onKey}>
      {!compact && <ReplayLegend data={data} highlight={highlight} onHighlight={setHighlight} />}
      <div className="replay-plot">
        <ReplayStage data={data} highlight={highlight} selectedEffect={selectedEffect} />
        <EffectList hud={hud} selected={selectedEffect} onSelect={setSelectedEffect} defaultCollapsed={compact} />
        <BossFrames hud={hud} />
        <div className="hud-bottom">
          <RaidFrames hud={hud} defaultCollapsed={compact} />
          <UnitFrame hud={hud} defaultCollapsed={compact} />
        </div>
      </div>
      <ReplayControls data={data} bounds={bounds} compact={compact} />
    </section>
  );
}
