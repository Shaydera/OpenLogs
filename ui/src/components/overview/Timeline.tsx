import { Fragment, useId, useRef } from 'react';
import type { QuickOverview } from '../../api/types';
import { formatEventTime } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { type TimeRange, analysedEndMs, useApp } from '../../store';
import { PullCutoffShade, afterCutTitle } from '../reports/CutoffShade';
import { clickToRange, fullRange, phaseInPull, rangeSpan, sameRange } from '../reports/rangeGeometry';
import { useBrush } from '../reports/useBrush';
import { useRangeKeys } from '../reports/useRangeKeys';
import { playerIndex, shortName, spellName } from './players';
import { TIMELINE_VIEW_BOX, percentOf, timelineGeometry, timelineSummary } from './timelineGeometry';

/**
 * The Overview's timeline and its range brush: drag to select, click a phase (or its
 * label) to select it, the accent handles are sliders for the keyboard. It always draws the whole pull;
 * the range filters what lies below. `run`: a whole Mythic+ run, which has no boss HP line; its boss
 * pulls are the named phases.
 */
export function Timeline({ overview, run = false }: { overview: QuickOverview; run?: boolean }) {
  const range = useApp((s) => s.range);
  const setRange = useApp((s) => s.setRange);
  const deathCutoff = useApp((s) => s.deathCutoff);
  const duration = overview.timeline.durationMs;
  const end = analysedEndMs(overview);
  const { markers, phases } = overview.timeline;
  const geometry = timelineGeometry(overview.timeline, duration);
  const phaseRanges = phases.map((phase) => phaseInPull(phase, end));
  const players = playerIndex(overview);
  const nameOf = (actorId: number) => shortName(players.get(actorId)?.name ?? '');
  const plotRef = useRef<HTMLDivElement>(null);
  const hintId = useId();

  const change = (next: TimeRange | null) => {
    if (!sameRange(next, range)) void setRange(next);
  };
  const brush = useBrush(plotRef, duration, range, change, (x, width) => change(clickToRange(x, width, duration, phases, range, end)), end);
  const keys = useRangeKeys(end, range, change, hintId);
  const shown = keys.draft !== undefined ? keys.draft : brush.preview !== undefined ? brush.preview : range;
  const selection = shown ?? fullRange(end);
  const from = percentOf(selection.startMs, duration);
  const to = percentOf(selection.endMs, duration);
  const cut = percentOf(end, duration);
  const selectedPhase = shown === null ? -1 : phaseRanges.findIndex((phaseRange) => phaseRange !== undefined && sameRange(phaseRange, shown));
  const note =
    shown === null
      ? t(run ? 'timeline.fullRun' : 'timeline.fullFight')
      : selectedPhase >= 0
        ? t('timeline.phaseSelected', { phase: geometry.phases[selectedPhase].label })
        : null;
  const lust = markers.bloodlust[0];

  return (
    <section className="panel tl-panel" aria-labelledby="timeline-title">
      <div className="tl-head">
        <div className="tl-legend">
          <h2 id="timeline-title" className="cap tl-title">
            {t('timeline.title')}
          </h2>
          {!run && (
            <span className="tl-key">
              <span className="tl-swatch tl-swatch-boss" aria-hidden="true" />
              {t('timeline.bossHp')}
            </span>
          )}
          <span className="tl-key">
            <span className="tl-swatch tl-swatch-dps" aria-hidden="true" />
            {t('timeline.raidDps')}
          </span>
          <span className="tl-key">
            <span className="tl-swatch tl-swatch-death" aria-hidden="true" />
            {t('timeline.death')}
          </span>
          {lust && (
            <span className="tl-key">
              <span className="tl-swatch tl-swatch-lust" aria-hidden="true" />
              {spellName(overview, lust.spellId)}
            </span>
          )}
        </div>
        <div className="tl-selection">
          {t('timeline.selection')} <span className="num">{rangeSpan(selection)}</span>
          {note ? ` ${note}` : ''}
          {` · ${t('timeline.dragHint')}`}
        </div>
      </div>
      <div className="tl-phase-labels">
        {geometry.phases.map((phase, i) => (
          <button
            key={phase.key}
            type="button"
            className="tl-phase-label"
            style={{ left: `${phase.leftPct}%`, width: `${phase.widthPct}%` }}
            title={afterCutTitle(phases[i].startMs, end, deathCutoff) ?? phase.label}
            aria-pressed={i === selectedPhase}
            disabled={phaseRanges[i] === undefined}
            onClick={() => change(i === selectedPhase ? null : (phaseRanges[i] ?? null))}
          >
            <span>{phase.label}</span>
          </button>
        ))}
      </div>
      <div
        ref={plotRef}
        className="tl-plot"
        data-testid="timeline-plot"
        title={t('range.brushHint')}
        onMouseDown={(event) => brush.start(event, 'brush')}
      >
        {geometry.phases.map((phase) => (
          <div
            key={phase.key}
            className={`tl-phase tl-phase-${phase.kind}`}
            style={{ left: `${phase.leftPct}%`, width: `${phase.widthPct}%` }}
          />
        ))}
        <svg viewBox={TIMELINE_VIEW_BOX} preserveAspectRatio="none" aria-hidden="true">
          {geometry.dpsPath && <path d={geometry.dpsPath} className="tl-dps" />}
          {geometry.bossHpPath && <path d={geometry.bossHpPath} className="tl-boss" />}
        </svg>
        {markers.bloodlust.map((use) => {
          const text = t('timeline.bloodlustMarker', {
            spell: spellName(overview, use.spellId),
            name: nameOf(use.player),
            time: formatEventTime(use.t),
          });
          return (
            <span
              key={`lust-${use.player}-${use.t}`}
              role="img"
              className="tl-marker tl-marker-lust"
              style={{ left: `${percentOf(use.t, duration)}%` }}
              aria-label={t('timeline.bloodlustLabel', { text })}
              title={text}
            />
          );
        })}
        {markers.deaths.map((death) => {
          const left = percentOf(death.t, duration);
          const name = nameOf(death.player);
          const time = formatEventTime(death.t);
          return (
            <Fragment key={`death-${death.player}-${death.t}`}>
              <span className="tl-marker tl-marker-death" style={{ left: `${left}%` }} aria-hidden="true" />
              <span
                role="img"
                className="tl-death-dot"
                style={{ left: `calc(${left}% - 5px)` }}
                aria-label={t('timeline.deathMarker', { name, time })}
                title={t('timeline.deathTitle', { name, time })}
              />
            </Fragment>
          );
        })}
        <PullCutoffShade overview={overview} />
        {shown !== null && (
          <>
            <div className="tl-dim" style={{ left: 0, width: `${from}%` }} />
            <div className="tl-dim" style={{ left: `${to}%`, width: `${cut - to}%` }} />
          </>
        )}
        <span
          className="tl-handle tl-handle-start"
          style={{ left: `${from}%` }}
          {...keys.handleProps('start', shown)}
          onMouseDown={(event) => brush.start(event, 'start')}
        />
        <span
          className="tl-handle tl-handle-end"
          style={{ left: `calc(${to}% - 6px)` }}
          {...keys.handleProps('end', shown)}
          onMouseDown={(event) => brush.start(event, 'end')}
        />
      </div>
      <div className="tl-ticks" aria-hidden="true">
        {geometry.ticks.map((tick) => (
          <span key={tick.label} className="num" style={{ left: `${tick.leftPct}%` }}>
            {tick.label}
          </span>
        ))}
      </div>
      <p className="sr-only">{timelineSummary(overview.timeline)}</p>
      <p className="sr-only" id={hintId}>
        {t('range.keysHint')}
      </p>
      {!geometry.hasBossData && <p className="muted tl-empty">{t(run ? 'timeline.runNoBossHp' : 'timeline.noBossData')}</p>}
    </section>
  );
}
