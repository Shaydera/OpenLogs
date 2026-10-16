import { type RefObject, useEffect, useMemo, useRef } from 'react';
import type { ReplayData } from '../../api/types';
import { t } from '../../i18n/i18n';
import { type IconRef, iconSrc } from '../../icons';
import { iconTables, loadIconTables, subscribeIconTables } from '../../gameData';
import { useApp } from '../../store';
import { pressGesture, wheelZoomFactor } from '../views/zoomGeometry';
import { type Camera, fitCamera, panCamera, pinchCamera, zoomAt } from './camera';
import { replayNow } from './ReplayControls';
import { type StageColors, readStageColors } from './stageColors';
import { STAGE_PAD_PX, type StageIndex, drawStage, hitUnit, indexStage, placeUnit, placeUnits, stageImage } from './stageDraw';

const LINE_PX = 16;
const PAGE_PX = 800;
/** Wheel events this close together are one turn: notches past a zoom limit must not scroll the page. */
const WHEEL_TURN_MS = 250;
const KEY_ZOOM = 1.25;
const EMPTY_CAMERA: Camera = { cx: 0, cy: 0, scale: 4 };

type Point = { x: number; y: number };

/** The top-down map: units at their logged positions. Wheel or pinch zooms, a drag pans, a double click fits, a click selects. */
export function ReplayStage({ data, highlight }: { data: ReplayData; highlight: number[] | null }) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const index = useMemo(() => indexStage(data), [data]);
  const highlighted = useRef<ReadonlySet<number> | null>(null);
  const invalidate = useRef<() => void>(() => {});

  useEffect(() => {
    highlighted.current = highlight && new Set(highlight);
    invalidate.current();
  }, [highlight]);

  useEffect(loadIconTables, []);

  useEffect(() => {
    if (!host.current || !canvas.current) return;
    const stage = mountStage(host.current, canvas.current, index, highlighted);
    invalidate.current = stage.invalidate;
    return () => {
      invalidate.current = () => {};
      stage.dispose();
    };
  }, [index]);

  return (
    <div ref={host} className="replay-stage" role="img" aria-label={t('replay.stage')} tabIndex={0}>
      <canvas ref={canvas} />
    </div>
  );
}

/** Draws the stage in an animation frame loop from the clock and the store, without React renders, and wires its gestures. */
function mountStage(element: HTMLDivElement, canvas: HTMLCanvasElement, index: StageIndex, highlight: RefObject<ReadonlySet<number> | null>) {
  const ctx = canvas.getContext('2d');
  const root = document.documentElement;
  let w = 0;
  let h = 0;
  let dpr = 1;
  let cam: Camera | null = null;
  let userMoved = false;
  let dirty = true;
  let hover: Point | null = null;
  let colors: StageColors | null = null;
  let colorsKey = '';
  let frameId = 0;

  const touches = new Map<number, Point>();
  let press: { pointerId: number; start: Point; origin: Camera; dragging: boolean } | null = null;
  let pinch: { ids: [number, number]; origin: Camera; from: [Point, Point] } | null = null;
  let wheelTurnUntil = -Infinity;

  const invalidate = () => {
    dirty = true;
  };

  const resize = (width: number, height: number): boolean => {
    const ratio = window.devicePixelRatio || 1;
    if (width === w && height === h && ratio === dpr) return false;
    w = width;
    h = height;
    dpr = ratio;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    if (!userMoved) cam = null;
    dirty = true;
    return true;
  };

  const fit = (): Camera => (index.bounds ? fitCamera(index.bounds, w, h, STAGE_PAD_PX) : EMPTY_CAMERA);

  /** The camera at `now`, centred on the selected unit while following it. */
  const camera = (now: number): Camera => {
    cam ??= fit();
    const { selected, follow } = useApp.getState().replay;
    const followed = follow && selected !== null ? index.byActor.get(selected) : undefined;
    const at = followed && placeUnit(followed, now);
    if (at) cam = { ...cam, cx: at.x, cy: at.y };
    return cam;
  };

  const placedAt = (now: number, view = camera(now)) => placeUnits(index, now, useApp.getState().replay.filters, view, w, h);

  const draw = () => {
    if (!ctx || !colors || w <= 0 || h <= 0) return;
    const now = replayNow();
    const { replay } = useApp.getState();
    const view = camera(now);
    const placed = placedAt(now, view);
    const hovered = hover && !press?.dragging && !pinch ? hitUnit(placed, hover.x, hover.y) : null;
    element.style.cursor = press?.dragging || pinch ? 'grabbing' : hovered ? 'pointer' : '';
    const tables = iconTables();
    const image = (icon: IconRef) => {
      const src = iconSrc(icon, tables);
      return src ? stageImage(src, invalidate) : null;
    };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawStage(ctx, { w, h, t: now, cam: view, colors, index, placed, layers: replay.layers, selected: replay.selected, highlight: highlight.current, hover: hovered, image });
  };

  const themeKey = () => `${root.dataset.theme}/${root.dataset.mode}`;

  const drawNow = () => {
    if (!colors || themeKey() !== colorsKey) {
      colors = readStageColors(root);
      colorsKey = themeKey();
    }
    dirty = false;
    draw();
  };

  const frame = () => {
    frameId = requestAnimationFrame(frame);
    resize(w, h);
    if (dirty || useApp.getState().replay.playing || themeKey() !== colorsKey) drawNow();
  };

  const local = (event: MouseEvent): Point => {
    const box = element.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const moveCamera = (next: Camera) => {
    cam = next;
    userMoved = true;
    dirty = true;
  };

  const down = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const at = local(event);
    if (event.pointerType === 'touch') {
      if (event.isPrimary) {
        touches.clear();
        pinch = null;
      }
      touches.set(event.pointerId, at);
      if (touches.size === 2) {
        const ids = [...touches.keys()] as [number, number];
        pinch = { ids, origin: camera(replayNow()), from: [touches.get(ids[0]) ?? at, touches.get(ids[1]) ?? at] };
        press = null;
      }
      if (touches.size > 1) return;
    }
    press = { pointerId: event.pointerId, start: at, origin: camera(replayNow()), dragging: false };
    element.setPointerCapture?.(event.pointerId);
  };

  const move = (event: PointerEvent) => {
    const at = local(event);
    if (touches.has(event.pointerId)) touches.set(event.pointerId, at);
    if (pinch) {
      if (!pinch.ids.includes(event.pointerId)) return;
      const [a, b] = pinch.ids.map((id) => touches.get(id) ?? at);
      moveCamera(pinchCamera(pinch.origin, pinch.from, [a, b], w, h));
      return;
    }
    if (press && event.pointerId === press.pointerId) {
      const dx = at.x - press.start.x;
      const dy = at.y - press.start.y;
      if (!press.dragging) {
        if (pressGesture(dx, dy, false) === 'click') return;
        press.dragging = true;
        // Following would pull the camera straight back to the selected unit.
        if (useApp.getState().replay.follow) useApp.getState().setReplayFollow(false);
      }
      moveCamera(panCamera(press.origin, dx, dy));
      return;
    }
    if (event.pointerType === 'mouse') {
      hover = at;
      dirty = true;
    }
  };

  const finish = (event: PointerEvent, clicked: boolean) => {
    touches.delete(event.pointerId);
    if (pinch?.ids.includes(event.pointerId)) pinch = null;
    if (!press || event.pointerId !== press.pointerId) return;
    if (clicked && !press.dragging) {
      const at = local(event);
      const hit = hitUnit(placedAt(replayNow()), at.x, at.y);
      if (hit) useApp.getState().selectReplayUnit(hit.stage.unit.actor);
    }
    press = null;
    dirty = true;
  };
  const up = (event: PointerEvent) => finish(event, true);
  const cancel = (event: PointerEvent) => finish(event, false);

  const leave = () => {
    hover = null;
    dirty = true;
  };

  const wheel = (event: WheelEvent) => {
    if (event.deltaY === 0) return;
    const unit = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? PAGE_PX : 1;
    const at = local(event);
    const current = camera(replayNow());
    const next = zoomAt(current, 1 / wheelZoomFactor(event.deltaY * unit), at.x, at.y, w, h);
    const turning = event.timeStamp < wheelTurnUntil;
    // A fresh turn that cannot zoom any further leaves the wheel to the page.
    if (!turning && next.scale === current.scale) return;
    event.preventDefault();
    wheelTurnUntil = event.timeStamp + WHEEL_TURN_MS;
    moveCamera(next);
  };

  const refit = (event: MouseEvent) => {
    event.preventDefault();
    cam = fit();
    userMoved = false;
    dirty = true;
  };

  const key = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === '0') {
      event.preventDefault();
      cam = fit();
      userMoved = false;
      dirty = true;
      return;
    }
    const factor = event.key === '+' || event.key === '=' ? KEY_ZOOM : event.key === '-' ? 1 / KEY_ZOOM : null;
    if (factor === null) return;
    event.preventDefault();
    moveCamera(zoomAt(camera(replayNow()), factor, w / 2, h / 2, w, h));
  };

  const box = element.getBoundingClientRect();
  resize(box.width, box.height);
  const observer =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(([entry]) => {
          // Resizing clears the canvas; drawing now instead of next frame keeps it from flashing blank while dragged.
          if (resize(entry.contentRect.width, entry.contentRect.height)) drawNow();
        });
  observer?.observe(element);
  const unsubscribe = useApp.subscribe(invalidate);
  const unsubscribeIcons = subscribeIconTables(invalidate);
  element.addEventListener('pointerdown', down);
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', up);
  element.addEventListener('pointercancel', cancel);
  element.addEventListener('lostpointercapture', cancel);
  element.addEventListener('pointerleave', leave);
  element.addEventListener('wheel', wheel, { passive: false });
  element.addEventListener('dblclick', refit);
  element.addEventListener('keydown', key);
  frameId = requestAnimationFrame(frame);

  return {
    invalidate,
    dispose() {
      cancelAnimationFrame(frameId);
      observer?.disconnect();
      unsubscribe();
      unsubscribeIcons();
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', cancel);
      element.removeEventListener('lostpointercapture', cancel);
      element.removeEventListener('pointerleave', leave);
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('dblclick', refit);
      element.removeEventListener('keydown', key);
    },
  };
}
