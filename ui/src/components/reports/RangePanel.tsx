import { type FocusEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, useEffect, useId, useRef, useState } from 'react';
import type { QuickOverview } from '../../api/types';
import { formatDuration, formatEventTime } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { effectiveView } from '../../reportViews';
import { type TimeRange, analysedEndMs, useApp } from '../../store';
import { clampWindow, rangeWindow, shownWindow } from '../views/zoomGeometry';
import { TIMELINE_VIEW_BOX, numberRepeats, percentOf, timelineGeometry } from '../overview/timelineGeometry';
import { PullCutoffShade, afterCutTitle } from './CutoffShade';
import { fullRange, phaseInPull, rangeInPull, rangeLabel, rangeSpan, sameRange } from './rangeGeometry';
import { SaveRangePopover } from './SaveRangePopover';
import { type SavedRange, deleteRange, loadSavedRanges, saveRange } from './savedRanges';
import { useBrush } from './useBrush';
import { useRangeKeys } from './useRangeKeys';

/**
 * The report tabs' "Time range" panel: pills for the full pull, its phases and the saved ranges,
 * the selection with its duration and the pull's bounds, "+ Save range", and a plot with the selection
 * as an accent brush.
 * With `collapsible`, it folds into one line with the selection that opens it again.
 */
export function RangePanel({
  overview,
  rangeKey,
  run = false,
  collapsible,
}: {
  overview: QuickOverview;
  rangeKey: string;
  run?: boolean;
  collapsible?: { open: boolean; onToggle(open: boolean): void };
}) {
  const range = useApp((s) => s.range);
  const setRange = useApp((s) => s.setRange);
  const zoom = useApp((s) => s.zoom);
  const setZoom = useApp((s) => s.setZoom);
  const timeline = useApp((s) => effectiveView(s.tab, s.details.length > 0, s.reportView) === 'timeline');
  const deathCutoff = useApp((s) => s.deathCutoff);
  const duration = overview.timeline.durationMs;
  const end = analysedEndMs(overview);
  const geometry = timelineGeometry(overview.timeline, duration);
  const pillLabels = numberRepeats(geometry.phases.map((phase) => phase.label));
  const phaseRanges = overview.timeline.phases.map((phase) => phaseInPull(phase, end));
  const plotRef = useRef<HTMLDivElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  const popoverId = useId();
  const [saved, setSaved] = useState<SavedRange[]>(() => loadSavedRanges(rangeKey));
  const [saving, setSaving] = useState(false);
  const expandRef = useRef<HTMLButtonElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const toggled = useRef(false);
  const collapsed = collapsible !== undefined && !collapsible.open;

  useEffect(() => setSaved(loadSavedRanges(rangeKey)), [rangeKey]);
  useEffect(() => {
    if (!toggled.current) return;
    toggled.current = false;
    (collapsed ? expandRef : collapseRef).current?.focus();
  }, [collapsed]);

  const change = (next: TimeRange | null) => {
    if (!sameRange(next, range)) void setRange(next);
  };
  // The pills select phases here; a click on the plot changes nothing.
  const brush = useBrush(plotRef, duration, range, change, () => {}, end);
  const keys = useRangeKeys(end, range, change, hintId);
  const shown = keys.draft !== undefined ? keys.draft : brush.preview !== undefined ? brush.preview : range;
  const selection = shown ?? fullRange(end);
  const from = percentOf(selection.startMs, duration);
  const to = percentOf(selection.endMs, duration);
  const cut = percentOf(end, duration);

  const whole = rangeWindow(range, end);
  const shownZoom = shownWindow(zoom, whole);
  const stopZoomDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopZoomDrag.current?.(), []);

  /** Dragging the timeline's window band pans the window inside the range. */
  function panZoom(event: ReactMouseEvent<HTMLSpanElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const width = plotRef.current?.getBoundingClientRect().width ?? 0;
    const x0 = event.clientX;
    const from = shownZoom;
    const move = (e: MouseEvent) => {
      const delta = width > 0 ? Math.round(((e.clientX - x0) / width) * duration) : 0;
      setZoom(clampWindow({ startMs: from.startMs + delta, endMs: from.endMs + delta }, whole));
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      stopZoomDrag.current = null;
    };
    stopZoomDrag.current?.();
    stopZoomDrag.current = up;
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  function toggle(open: boolean) {
    toggled.current = true;
    collapsible?.onToggle(open);
  }

  function closeSave(returnFocus: boolean) {
    setSaving(false);
    if (returnFocus) saveRef.current?.focus();
  }

  function onSaveKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape' || !saving) return;
    event.preventDefault();
    closeSave(true);
  }

  function onSaveBlur(event: FocusEvent<HTMLDivElement>) {
    // Focus left the pill and its form (Tab past it, a click elsewhere): close it.
    if (!event.currentTarget.contains(event.relatedTarget)) setSaving(false);
  }

  const chevron = (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 4.5 L6 7.5 L9 4.5" />
    </svg>
  );

  if (collapsed)
    return (
      <section className="range-line" aria-label={t('range.title')}>
        <button ref={expandRef} type="button" className="range-toggle" aria-expanded={false} title={t('range.expand')} onClick={() => toggle(true)}>
          {chevron}
          <span className="cap range-cap">{t('range.title')}</span>
          {range === null ? <span>{t(run ? 'range.wholeRun' : 'range.whole')}</span> : <span className="num">{rangeLabel(range)}</span>}
          <span className="num range-line-pull">{t('range.bounds', { start: formatEventTime(0), end: formatEventTime(duration) })}</span>
        </button>
      </section>
    );

  return (
    <section className="panel range-panel" aria-label={t('range.title')}>
      <div className="range-pills">
        {collapsible && (
          <button
            ref={collapseRef}
            type="button"
            className="range-collapse"
            aria-expanded={true}
            aria-label={t('range.collapse')}
            title={t('range.collapse')}
            onClick={() => toggle(false)}
          >
            {chevron}
          </button>
        )}
        <span className="cap range-cap" aria-hidden="true">
          {t('range.title')}
        </span>
        <button type="button" className={range === null ? 'pill on' : 'pill'} aria-pressed={range === null} onClick={() => change(null)}>
          {t(run ? 'range.wholeRun' : 'range.whole')}
        </button>
        {geometry.phases.map((phase, i) => {
          const phaseRange = phaseRanges[i];
          const on = range !== null && phaseRange !== undefined && sameRange(phaseRange, range);
          return (
            <button
              key={phase.key}
              type="button"
              className={on ? 'pill on' : 'pill'}
              aria-pressed={on}
              disabled={phaseRange === undefined}
              title={afterCutTitle(overview.timeline.phases[i].startMs, end, deathCutoff)}
              onClick={() => phaseRange !== undefined && change(phaseRange)}
            >
              {pillLabels[i]}
            </button>
          );
        })}
        {saved.map((entry) => {
          // Saved per boss and difficulty: a range from a longer pull is cut to this one, or left out.
          const entryRange = rangeInPull(entry, end);
          const on = range !== null && entryRange !== undefined && sameRange(entryRange, range);
          return (
            <span key={entry.name} className={on ? 'pill pill-saved on' : 'pill pill-saved'}>
              <button
                type="button"
                className="pill-saved-name"
                aria-pressed={on}
                disabled={entryRange === undefined}
                title={entryRange === undefined ? t('range.savedOutside', { range: rangeLabel(entry) }) : rangeLabel(entry)}
                onClick={() => entryRange !== undefined && change(entryRange)}
              >
                {entry.name}
              </button>
              <button
                type="button"
                className="pill-saved-x"
                aria-label={t('range.delete', { name: entry.name })}
                onClick={() => setSaved(deleteRange(rangeKey, entry.name))}
              >
                ×
              </button>
            </span>
          );
        })}
        <div className="range-end">
          <div className="range-details">
            <span>
              {t('range.selection')} <span className="num range-value">{rangeSpan(selection)}</span> · {t('range.duration')}{' '}
              <span className="num range-value">{formatDuration(selection.endMs - selection.startMs)}</span>
            </span>
            <span className="num">{t('range.bounds', { start: formatEventTime(0), end: formatEventTime(duration) })}</span>
          </div>
          <div className="range-save" onKeyDown={onSaveKey} onBlur={onSaveBlur}>
            <button
              ref={saveRef}
              type="button"
              className="pill"
              disabled={range === null}
              title={range === null ? t('range.saveNeedsRange') : undefined}
              aria-expanded={saving}
              aria-controls={saving ? popoverId : undefined}
              onClick={() => setSaving(!saving)}
            >
              {t('range.saveOpen')}
            </button>
            {saving && range !== null && (
              <SaveRangePopover
                id={popoverId}
                onSave={(name) => {
                  setSaved(saveRange(rangeKey, { name, startMs: range.startMs, endMs: range.endMs }));
                  closeSave(true);
                }}
                onCancel={() => closeSave(true)}
              />
            )}
          </div>
        </div>
      </div>
      <div
        ref={plotRef}
        className="range-plot"
        data-testid="range-plot"
        title={t('range.brushHint')}
        onMouseDown={(event) => brush.start(event, 'brush')}
      >
        <svg viewBox={TIMELINE_VIEW_BOX} preserveAspectRatio="none" aria-hidden="true">
          {geometry.dpsPath && <path d={geometry.dpsPath} className="tl-dps" />}
          {geometry.bossHpPath && <path d={geometry.bossHpPath} className="tl-boss" />}
        </svg>
        <PullCutoffShade overview={overview} />
        <div className="range-dim" style={{ left: 0, width: `${from}%` }} />
        <div className="range-dim" style={{ left: `${to}%`, width: `${cut - to}%` }} />
        <div className="range-brush" style={{ left: `${from}%`, width: `${to - from}%` }}>
          <span
            className="range-handle range-handle-start"
            {...keys.handleProps('start', shown)}
            onMouseDown={(event) => brush.start(event, 'start')}
          />
          <span className="range-handle range-handle-end" {...keys.handleProps('end', shown)} onMouseDown={(event) => brush.start(event, 'end')} />
        </div>
        {timeline && (
          <span
            className="range-zoom"
            data-testid="range-zoom"
            title={t('range.zoomHint')}
            style={{ left: `${percentOf(shownZoom.startMs, duration)}%`, width: `${percentOf(shownZoom.endMs, duration) - percentOf(shownZoom.startMs, duration)}%` }}
            onMouseDown={panZoom}
          />
        )}
      </div>
      <p className="sr-only" id={hintId}>
        {t('range.keysHint')}
      </p>
    </section>
  );
}
