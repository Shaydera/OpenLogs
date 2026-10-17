import { type Dispatch, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type SetStateAction, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Timeline } from '../../api/types';
import { spellIcon } from '../../icons';
import { formatEventTime, formatSpan } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { lanesOf } from '../../reportViews';
import type { FilterTab } from '../../scopeSides';
import { type TimeRange, type ViewToggles, useApp } from '../../store';
import { GameIcon } from '../GameIcon';
import { GroupMenu } from '../filters/GroupMenu';
import { NoMatch } from '../filters/NoMatch';
import { rosterIndex } from '../reports/reportData';
import { itemTip } from './itemTip';
import { ResourceLanes } from './ResourceLanes';
import { ContextRow, DEBUFF_COLOURS, LaneRow, type MarkHandler, laneKey } from './TimelineLane';
import { Playhead, Ruler } from './TimelineRuler';
import { TIP_PX, type Tip, TipCard } from './TimelineTip';
import { useTimelineGestures } from './useTimelineGestures';
import { TAB_TITLE, ViewFailure, ViewHead } from './ViewHead';
import { type ViewNames, viewNames } from './viewNames';
import { panBy, percentIn, presetWindow, presets, rangeWindow, shownWindow, windowSpan, zoomBy } from './zoomGeometry';

const TOGGLES: Partial<Record<FilterTab, (keyof ViewToggles)[]>> = { casts: ['rejected'], taken: ['hits'] };
/** While the window moves, the timeline asks for what it needs at most this often, and announces it once it settled this long. */
const REFRESH_MS = 120;

/** The width of the element set with the returned ref callback. */
function useWidth(fallback: number) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => element.clientWidth > 0 && setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, width] as const;
}

const windowLabel = (window: TimeRange) => `${formatEventTime(window.startMs)} – ${formatEventTime(window.endMs)} · ${formatSpan(windowSpan(window))}`;

/** The tab's marks in a zoom window inside the range: one lane per row of the lane dimension, the encounter's casts above. */
export function TimelineView({ tab }: { tab: FilterTab }) {
  const timeline = useApp((s) => s.timeline);
  const zoom = useApp((s) => s.zoom);
  const setZoom = useApp((s) => s.setZoom);
  const refreshTimeline = useApp((s) => s.refreshTimeline);
  const range = useApp((s) => s.range);
  const durationMs = useApp((s) => s.overview?.timeline.durationMs ?? 0);
  const lanes = useApp((s) => s.lanes);
  const setLanes = useApp((s) => s.setLanes);
  const viewError = useApp((s) => s.viewError);
  const viewLoading = useApp((s) => s.viewLoading);
  const whole = useMemo(() => rangeWindow(range, durationMs), [range, durationMs]);
  const shown = useMemo(() => shownWindow(zoom, whole), [zoom, whole]);
  const [tip, setTip] = useState<Tip | null>(null);
  const settled = useRef(windowLabel(shown));
  const [announced, setAnnounced] = useState('');
  const lastRefresh = useRef(-Infinity);
  const [loadingNoted, setLoadingNoted] = useState(viewLoading);

  useEffect(() => {
    const timer = setTimeout(
      () => {
        lastRefresh.current = Date.now();
        void refreshTimeline();
      },
      Math.max(0, lastRefresh.current + REFRESH_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [shown, refreshTimeline]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const label = windowLabel(shown);
      if (label !== settled.current) {
        settled.current = label;
        setAnnounced(label);
      }
    }, REFRESH_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  // While the window keeps moving the loading note stays put, so a gesture's many requests are announced once.
  useEffect(() => {
    if (viewLoading) {
      setLoadingNoted(true);
      return;
    }
    const timer = setTimeout(() => setLoadingNoted(false), REFRESH_MS);
    return () => clearTimeout(timer);
  }, [viewLoading, shown]);

  const title = t('tl.title', { tab: t(TAB_TITLE[tab]) });
  const legend = tab === 'taken' && timeline && timeline.legend.length > 0 && <Legend timeline={timeline} shown={shown} />;
  const lanesMenu = (
    <GroupMenu tab={tab} caption={t('lanes.caption')} value={timeline?.axis ?? lanesOf(lanes, tab)} onPick={(dimension) => void setLanes(dimension)} />
  );
  const centre = (shown.startMs + shown.endMs) / 2;
  return (
    <section className="panel tl-panel" aria-labelledby="timeline-title">
      <ViewHead tab={tab} id="timeline-title" title={title} summary={legend} toggles={TOGGLES[tab] ?? []} extra={lanesMenu} />
      <div className="zbar">
        <span className="cap">{t('tl.zoom')}</span>
        <button type="button" className="zbtn" aria-label={t('tl.zoomOut')} onClick={() => setZoom(zoomBy(shown, 2, centre, whole))}>
          −
        </button>
        <div className="seg" role="group" aria-label={t('tl.length')}>
          {presets(whole).map((length) => {
            const on = length === null ? windowSpan(shown) === windowSpan(whole) : windowSpan(shown) === length;
            return (
              <button key={length ?? 'range'} type="button" className={on ? 'on' : undefined} aria-pressed={on} onClick={() => setZoom(presetWindow(shown, length, whole))}>
                {length === null ? t('tl.range') : formatSpan(length)}
              </button>
            );
          })}
        </div>
        <button type="button" className="zbtn" aria-label={t('tl.zoomIn')} onClick={() => setZoom(zoomBy(shown, 0.5, centre, whole))}>
          +
        </button>
        <span className="zbar-split" aria-hidden="true" />
        <button type="button" className="zbtn" aria-label={t('tl.earlier')} onClick={() => setZoom(panBy(shown, -0.5, whole))}>
          ←
        </button>
        <span className="num">
          {windowLabel(shown)}
        </span>
        <span className="sr-only" aria-live="polite">
          {announced}
        </span>
        <button type="button" className="zbtn" aria-label={t('tl.later')} onClick={() => setZoom(panBy(shown, 0.5, whole))}>
          →
        </button>
        <span className="zbar-hint">{t('tl.hint')}</span>
      </div>
      <p className="sr-only" role="status">
        {viewLoading || loadingNoted ? t('report.loading') : ''}
      </p>
      {viewError !== null && <ViewFailure reason={viewError} retry />}
      {timeline === null ? (
        viewError === null && <p className="muted pad">{t(viewLoading ? 'report.loading' : 'tl.notLoaded')}</p>
      ) : timeline.lanes.length === 0 ? (
        <div className={viewLoading ? 'dim' : undefined} aria-busy={viewLoading}>
          <NoMatch nothing={t('tl.nothing')} />
        </div>
      ) : (
        <TimelineBody tab={tab} timeline={timeline} shown={shown} whole={whole} busy={viewLoading} tip={tip} onTip={setTip} />
      )}
      <div className="tl-position">
        <span>{t('tl.window')}</span>
        <div className="tl-scroll" aria-hidden="true">
          <span style={{ left: `${percentIn(shown.startMs, whole)}%`, width: `${(windowSpan(shown) / Math.max(1, windowSpan(whole))) * 100}%` }} />
        </div>
        <span className="num">{t('tl.position', { from: formatEventTime(shown.startMs), to: formatEventTime(shown.endMs), end: formatEventTime(whole.endMs) })}</span>
      </div>
    </section>
  );
}

/** Where a mark's card opens, in px from the body's corner, kept inside the body's width. */
function cardPoint(body: HTMLElement | null, event: ReactMouseEvent<HTMLElement>, keyboard: boolean) {
  const box = body?.getBoundingClientRect();
  const mark = keyboard ? event.currentTarget.getBoundingClientRect() : null;
  const x = (mark ? mark.left : event.clientX) - (box?.left ?? 0);
  const y = (mark ? mark.bottom : event.clientY) - (box?.top ?? 0);
  return { x: box ? Math.max(0, Math.min(x, box.width - TIP_PX - 14)) : x, y };
}

const debuffNames = (timeline: Timeline, names: ViewNames) => [...new Set(timeline.legend.map((spellId) => names.spell(spellId)))];

/** The debuffs Damage Taken draws, in order of appearance, in their colours. */
function Legend({ timeline, shown }: { timeline: Timeline; shown: TimeRange }) {
  const names = useMemo(() => viewNames(timeline), [timeline]);
  const drawn = useMemo(
    () =>
      new Set(
        timeline.lanes
          .flatMap((lane) => lane.items)
          .filter((item) => item.kind === 'aura' && item.startMs < shown.endMs && item.spanEndMs > shown.startMs)
          .map((item) => names.spell(item.spellId)),
      ),
    [timeline, names, shown],
  );
  const listed = debuffNames(timeline, names);
  if (!listed.some((name) => drawn.has(name))) return null;
  return (
    <ul className="tl-legend" aria-label={t('tl.legend')}>
      {listed.map((name, place) => {
        if (!drawn.has(name)) return null;
        const spellId = timeline.legend.find((id) => names.spell(id) === name) ?? 0;
        return (
          <li key={name}>
            <span className="tl-swatch" style={{ background: DEBUFF_COLOURS[place % DEBUFF_COLOURS.length] }} />
            <GameIcon icon={spellIcon(spellId)} size={16} name={name} />
            {name}
          </li>
        );
      })}
    </ul>
  );
}

function TimelineBody(props: {
  tab: FilterTab;
  timeline: Timeline;
  shown: TimeRange;
  whole: TimeRange;
  busy: boolean;
  tip: Tip | null;
  onTip: Dispatch<SetStateAction<Tip | null>>;
}) {
  const { tab, timeline, shown, whole, busy, tip, onTip } = props;
  const names = useMemo(() => viewNames(timeline), [timeline]);
  const roster = useMemo(() => rosterIndex(timeline.roster), [timeline]);
  const body = useRef<HTMLDivElement>(null);
  const tipId = useId();
  const [setTrack, trackPx] = useWidth(1000);
  const grabbing = useTimelineGestures(body, whole);

  const onEnter = useCallback<MarkHandler>(
    (item, context, event) => {
      const next: Tip = { item, context, ...cardPoint(body.current, event, false), pinned: false, opener: event.currentTarget, keyboard: false };
      onTip((current) => (current?.pinned ? current : next));
    },
    [onTip],
  );
  const onLeave = useCallback(() => onTip((current) => (current?.pinned ? current : null)), [onTip]);
  const onPin = useCallback<MarkHandler>(
    (item, context, event) => {
      // A click from the keyboard has no pointer position: the card opens under the mark and takes the focus.
      const keyboard = event.detail === 0;
      onTip({ item, context, ...cardPoint(body.current, event, keyboard), pinned: true, opener: event.currentTarget, keyboard });
    },
    [onTip],
  );
  const closeCard = () => {
    const opener = tip?.opener;
    onTip(null);
    if (opener?.isConnected) opener.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !tip?.pinned) return;
    event.stopPropagation();
    closeCard();
  };

  useEffect(() => {
    if (!tip || tip.pinned) return;
    const { opener } = tip;
    opener.setAttribute('aria-describedby', tipId);
    return () => opener.removeAttribute('aria-describedby');
  }, [tip, tipId]);

  const legend = useMemo(() => (tab === 'taken' ? debuffNames(timeline, names) : null), [tab, timeline, names]);
  const row = { shown, names, widthPx: trackPx, legend, onEnter, onLeave, onPin };
  return (
    <div className={grabbing ? 'tl-body grabbing' : 'tl-body'} ref={body} onKeyDown={onKeyDown}>
      <div className={busy ? 'dim' : undefined} aria-busy={busy}>
        <div className="tl-lane tl-ruler-row">
          <span className="tl-label">
            <span className="cap">{timeline.axis ? t(`lanes.${timeline.axis}`) : ''}</span>
          </span>
          <Ruler shown={shown} whole={whole} widthPx={trackPx} trackRef={setTrack} />
        </div>
        {timeline.context.length > 0 && <ContextRow items={timeline.context} {...row} />}
        {tab === 'resources' ? (
          <ResourceLanes lanes={timeline.lanes} roster={roster} row={row} />
        ) : (
          timeline.lanes.map((lane) => <LaneRow key={laneKey(lane)} tab={tab} lane={lane} roster={roster} {...row} />)
        )}
      </div>
      <Playhead shown={shown} />
      {tip && <TipCard id={tipId} tip={tip} tipText={itemTip(tip.item, names, timeline.linesListed, tip.context)} onClose={closeCard} />}
    </div>
  );
}
