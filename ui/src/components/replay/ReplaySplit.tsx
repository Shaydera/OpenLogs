import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { ErrorBoundary } from '../ErrorBoundary';
import { ReplayTab } from './ReplayTab';

const MIN_PANE_PX = 420;
const DIVIDER_PX = 16;
const KEY_STEP_PX = 24;

/** The replay pane's width kept between both panes' minimum; an unmeasured split only keeps the replay's minimum. */
function clampReplayWidth(width: number, splitPx: number): number {
  const max = splitPx > 0 ? Math.max(MIN_PANE_PX, splitPx - DIVIDER_PX - MIN_PANE_PX) : Infinity;
  return Math.round(Math.min(Math.max(width, MIN_PANE_PX), max));
}

function useSplitWidth() {
  const element = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const split = element.current;
    if (!split || typeof ResizeObserver === 'undefined') return;
    const measure = () => setWidth(split.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(split);
    return () => observer.disconnect();
  }, []);
  return [element, width] as const;
}

/** The split's distance from the top of the page: the replay pane is as tall as the window below it at scroll 0. */
function usePageTop(element: RefObject<HTMLElement | null>) {
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const split = element.current;
    if (!split || typeof ResizeObserver === 'undefined') return;
    // The header above grows when its figures load: any page resize can move the split.
    const measure = () => setTop(Math.round(split.getBoundingClientRect().top + window.scrollY));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [element]);
  return top;
}

/** The report beside the compact replay, split by a divider that a drag or the arrow keys move. */
export function ReplaySplit({ children }: { children: ReactNode }) {
  const storedWidth = useApp((s) => s.replay.splitWidth);
  const setReplaySplitWidth = useApp((s) => s.setReplaySplitWidth);
  const setReplaySplit = useApp((s) => s.setReplaySplit);
  const [split, splitPx] = useSplitWidth();
  const pageTop = usePageTop(split);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number; width: number } | null>(null);
  const paneId = useId();
  const width = clampReplayWidth(dragWidth ?? storedWidth, splitPx);
  const maxWidth = splitPx > 0 ? clampReplayWidth(Infinity, splitPx) : undefined;

  function down(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, width };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const press = drag.current;
    if (press?.pointerId !== event.pointerId) return;
    press.width = clampReplayWidth(press.startWidth - (event.clientX - press.startX), splitPx);
    setDragWidth(press.width);
  }
  function release(event: PointerEvent<HTMLDivElement>) {
    const press = drag.current;
    if (press?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (press.width !== storedWidth) setReplaySplitWidth(press.width);
    setDragWidth(null);
  }
  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = clampReplayWidth(width + (event.key === 'ArrowLeft' ? KEY_STEP_PX : -KEY_STEP_PX), splitPx);
    if (next !== storedWidth) setReplaySplitWidth(next);
  }

  return (
    <div
      ref={split}
      className="replay-split"
      style={{ gridTemplateColumns: `minmax(0, 1fr) ${DIVIDER_PX}px ${width}px`, '--replay-split-top': `${pageTop}px` } as CSSProperties}
    >
      <div className="replay-split-report">{children}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('replay.resize')}
        aria-controls={paneId}
        aria-valuenow={width}
        aria-valuemin={MIN_PANE_PX}
        aria-valuemax={maxWidth}
        tabIndex={0}
        className={dragWidth === null ? 'replay-divider' : 'replay-divider dragging'}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onKeyDown={key}
      >
        <span className="replay-divider-line" aria-hidden="true" />
        <span className="replay-divider-grip" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </div>
      <div id={paneId} className="replay-split-pane">
        <ErrorBoundary onReset={() => setReplaySplit(false)}>
          <ReplayTab compact />
        </ErrorBoundary>
      </div>
    </div>
  );
}
