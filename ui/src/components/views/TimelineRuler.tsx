import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { formatEventTime } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { type TimeRange, useApp } from '../../store';
import { dragWindow, panBy, percentIn, rulerTicks, timeAtX, wheelPanFraction, wheelZoomFactor, zoomBy } from './zoomGeometry';

const LINE_PX = 16;
const PAGE_PX = 800;

/** How far a wheel turned, in px: browsers count it in lines or pages too, and turn a Shift + wheel into a horizontal one. */
function wheelPx(event: WheelEvent): number {
  const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * LINE_PX;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * PAGE_PX;
  return delta;
}

/** The time axis of the shown window: a drag across it zooms to the span, Ctrl + wheel zooms around the pointer, Shift + wheel pans. */
export function Ruler({ shown, whole, widthPx, trackRef }: { shown: TimeRange; whole: TimeRange; widthPx: number; trackRef: (element: HTMLElement | null) => void }) {
  const setZoom = useApp((s) => s.setZoom);
  const ruler = useRef<HTMLDivElement | null>(null);
  const stopDrag = useRef<(() => void) | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const latest = useRef({ shown, whole });
  latest.current = { shown, whole };
  const ticks = rulerTicks(shown, widthPx);
  const setRuler = useCallback(
    (element: HTMLDivElement | null) => {
      ruler.current = element;
      trackRef(element);
    },
    [trackRef],
  );

  useEffect(() => {
    const element = ruler.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.shiftKey) return;
      event.preventDefault();
      const px = wheelPx(event);
      if (px === 0) return;
      const { shown: window, whole: limits } = latest.current;
      const box = element.getBoundingClientRect();
      if (event.ctrlKey) setZoom(zoomBy(window, wheelZoomFactor(px), timeAtX(event.clientX - box.left, box.width, window), limits));
      else setZoom(panBy(window, wheelPanFraction(px), limits));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [setZoom]);

  useEffect(() => () => stopDrag.current?.(), []);

  function start(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    const from = event.clientX - box.left;
    const move = (e: MouseEvent) => setDrag({ from, to: e.clientX - box.left });
    const stop = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      stopDrag.current = null;
    };
    const up = (e: MouseEvent) => {
      stop();
      setDrag(null);
      const next = dragWindow(from, e.clientX - box.left, box.width, latest.current.shown, latest.current.whole);
      if (next) setZoom(next);
    };
    stopDrag.current?.();
    stopDrag.current = stop;
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  return (
    <div ref={setRuler} className="tl-ruler" data-testid="timeline-ruler" title={t('tl.rulerHint')} onMouseDown={start}>
      {drag && <span className="tl-drag" style={{ left: Math.min(drag.from, drag.to), width: Math.abs(drag.to - drag.from) }} />}
      {ticks.minor.map((ms) => (
        <span key={`m${ms}`} className="tl-tick minor" style={{ left: `${percentIn(ms, shown)}%` }} />
      ))}
      {ticks.major.map((ms) => (
        <span key={ms} className="tl-tick major" style={{ left: `${percentIn(ms, shown)}%` }}>
          <span className="tl-tick-label num">{formatEventTime(ms)}</span>
        </span>
      ))}
    </div>
  );
}
