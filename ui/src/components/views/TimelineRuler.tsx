import { type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react';
import { formatEventTime } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { type TimeRange, useApp } from '../../store';
import { dragWindow, percentIn, rulerTicks } from './zoomGeometry';

/** The time axis of the shown window: a drag across it zooms to the span. */
export function Ruler({ shown, whole, widthPx, trackRef }: { shown: TimeRange; whole: TimeRange; widthPx: number; trackRef: (element: HTMLElement | null) => void }) {
  const setZoom = useApp((s) => s.setZoom);
  const stopDrag = useRef<(() => void) | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const latest = useRef({ shown, whole });
  latest.current = { shown, whole };
  const ticks = rulerTicks(shown, widthPx);

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
    <div ref={trackRef} className="tl-ruler" data-testid="timeline-ruler" title={t('tl.rulerHint')} onMouseDown={start}>
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
