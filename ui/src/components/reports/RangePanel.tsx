import { type FocusEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import type { QuickOverview } from '../../api/types';
import { formatDuration, formatEventTime } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { type TimeRange, useApp } from '../../store';
import { TIMELINE_VIEW_BOX, numberRepeats, percentOf, timelineGeometry } from '../overview/timelineGeometry';
import { fullRange, normalizeRange, rangeInPull, rangeLabel, rangeSpan, sameRange } from './rangeGeometry';
import { SaveRangePopover } from './SaveRangePopover';
import { type SavedRange, deleteRange, loadSavedRanges, saveRange } from './savedRanges';
import { useBrush } from './useBrush';
import { useRangeKeys } from './useRangeKeys';

/**
 * The report tabs' "Time range" panel: pills for the full pull, its phases and the saved ranges,
 * "+ Save range", a plot with the selection as an accent brush, and the selection with its duration.
 */
export function RangePanel({ overview, rangeKey, run = false }: { overview: QuickOverview; rangeKey: string; run?: boolean }) {
  const range = useApp((s) => s.range);
  const setRange = useApp((s) => s.setRange);
  const duration = overview.timeline.durationMs;
  const geometry = timelineGeometry(overview.timeline, duration);
  const pillLabels = numberRepeats(geometry.phases.map((phase) => phase.label));
  const phaseRanges = overview.timeline.phases.map((phase) => normalizeRange({ startMs: phase.startMs, endMs: phase.endMs }, duration));
  const plotRef = useRef<HTMLDivElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  const popoverId = useId();
  const [saved, setSaved] = useState<SavedRange[]>(() => loadSavedRanges(rangeKey));
  const [saving, setSaving] = useState(false);

  useEffect(() => setSaved(loadSavedRanges(rangeKey)), [rangeKey]);

  const change = (next: TimeRange | null) => {
    if (!sameRange(next, range)) void setRange(next);
  };
  // The pills select phases here; a click on the plot changes nothing.
  const brush = useBrush(plotRef, duration, range, change, () => {});
  const keys = useRangeKeys(duration, range, change, hintId);
  const shown = keys.draft !== undefined ? keys.draft : brush.preview !== undefined ? brush.preview : range;
  const selection = shown ?? fullRange(duration);
  const from = percentOf(selection.startMs, duration);
  const to = percentOf(selection.endMs, duration);

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

  return (
    <section className="panel range-panel" aria-label={t('range.title')}>
      <div className="range-pills">
        <span className="cap range-cap" aria-hidden="true">
          {t('range.title')}
        </span>
        <button type="button" className={range === null ? 'pill on' : 'pill'} aria-pressed={range === null} onClick={() => change(null)}>
          {t(run ? 'range.wholeRun' : 'range.whole')}
        </button>
        {geometry.phases.map((phase, i) => {
          const on = range !== null && sameRange(phaseRanges[i], range);
          return (
            <button key={phase.key} type="button" className={on ? 'pill on' : 'pill'} aria-pressed={on} onClick={() => change(phaseRanges[i])}>
              {pillLabels[i]}
            </button>
          );
        })}
        {saved.map((entry) => {
          // Saved per boss and difficulty: a range from a longer pull is cut to this one, or left out.
          const entryRange = rangeInPull(entry, duration);
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
        <div className="range-dim" style={{ left: 0, width: `${from}%` }} />
        <div className="range-dim" style={{ right: 0, width: `${100 - to}%` }} />
        <div className="range-brush" style={{ left: `${from}%`, width: `${to - from}%` }}>
          <span
            className="range-handle range-handle-start"
            {...keys.handleProps('start', shown)}
            onMouseDown={(event) => brush.start(event, 'start')}
          />
          <span className="range-handle range-handle-end" {...keys.handleProps('end', shown)} onMouseDown={(event) => brush.start(event, 'end')} />
        </div>
      </div>
      <div className="range-foot">
        <span>
          {t('range.selection')} <span className="num range-value">{rangeSpan(selection)}</span> · {t('range.duration')}{' '}
          <span className="num range-value">{formatDuration(selection.endMs - selection.startMs)}</span>
        </span>
        <span className="num">{t('range.bounds', { start: formatEventTime(0), end: formatEventTime(duration) })}</span>
      </div>
      <p className="sr-only" id={hintId}>
        {t('range.keysHint')}
      </p>
    </section>
  );
}
