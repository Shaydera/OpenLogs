import { type CSSProperties, type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react';
import { formatEventTime } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { type TimeRange, replaySplitShown, useApp } from '../../store';
import { dragWindow, percentIn, pressGesture, rulerTicks, timeAtX } from './zoomGeometry';

/** The time axis of the shown window: a drag across it zooms to the span; with the replay alongside, a click seeks it. */
export function Ruler({ shown, whole, widthPx, trackRef }: { shown: TimeRange; whole: TimeRange; widthPx: number; trackRef: (element: HTMLElement | null) => void }) {
  const setZoom = useApp((s) => s.setZoom);
  const setReplayTime = useApp((s) => s.setReplayTime);
  const split = useApp(replaySplitShown);
  const stopDrag = useRef<(() => void) | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const latest = useRef({ shown, whole, split });
  latest.current = { shown, whole, split };
  const ticks = rulerTicks(shown, widthPx);

  useEffect(() => () => stopDrag.current?.(), []);

  function start(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    const from = event.clientX - box.left;
    const fromY = event.clientY;
    const move = (e: MouseEvent) => setDrag({ from, to: e.clientX - box.left });
    const stop = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      stopDrag.current = null;
    };
    const up = (e: MouseEvent) => {
      stop();
      setDrag(null);
      const to = e.clientX - box.left;
      if (pressGesture(to - from, e.clientY - fromY, false) === 'click') {
        if (latest.current.split) setReplayTime(timeAtX(from, box.width, latest.current.shown));
        return;
      }
      const next = dragWindow(from, to, box.width, latest.current.shown, latest.current.whole);
      if (next) setZoom(next);
    };
    stopDrag.current?.();
    stopDrag.current = stop;
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  return (
    <div ref={trackRef} className="tl-ruler" data-testid="timeline-ruler" title={t(split ? 'tl.rulerHintSplit' : 'tl.rulerHint')} onMouseDown={start}>
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

/** Where the replay alongside stands in the shown window: a line across the lanes' tracks, none outside the window. */
export function Playhead({ shown }: { shown: TimeRange }) {
  const time = useApp((s) => (replaySplitShown(s) ? s.replay.time : null));
  if (time === null) return null;
  const at = percentIn(time, shown);
  if (at < 0 || at > 100) return null;
  return <span className="tl-playhead" style={{ '--at': at / 100 } as CSSProperties} aria-hidden="true" />;
}
