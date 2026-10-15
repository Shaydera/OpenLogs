import { type RefObject, useEffect, useRef, useState } from 'react';
import { type TimeRange, useApp } from '../../store';
import { grabWindow, pinchWindow, pressGesture, sameWindow, shownWindow, wheelPans, wheelWindow } from './zoomGeometry';

/** A click this soon after a drag or pinch ends belongs to it: a touch tap's click can arrive well after the pointerup. */
const GESTURE_CLICK_MS = 400;
/** Wheel events this close together are one turn: extra notches or trackpad momentum past a zoom limit must not scroll the page. */
const WHEEL_TURN_MS = 250;

interface Point {
  x: number;
  y: number;
}

interface Press {
  pointerId: number;
  start: Point;
  origin: TimeRange;
  widthPx: number;
  touch: boolean;
  dragging: boolean;
}

interface Pinch {
  ids: [number, number];
  origin: TimeRange;
  from: [number, number];
  leftPx: number;
  widthPx: number;
}

const laneTrack = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>('.tl-track') : null);
const wheelTrack = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>('.tl-track, .tl-ruler') : null);

/**
 * The timeline's mouse and touch control inside `body`: the wheel over a track or the ruler zooms or pans; a drag along a lane
 * track, or one finger, moves the window; two fingers pinch it. Returns whether a drag is under way.
 */
export function useTimelineGestures(body: RefObject<HTMLElement | null>, whole: TimeRange): boolean {
  const setZoom = useApp((s) => s.setZoom);
  const [grabbing, setGrabbing] = useState(false);
  const latestWhole = useRef(whole);
  latestWhole.current = whole;

  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const touches = new Map<number, Point>();
    let press: Press | null = null;
    let pinch: Pinch | null = null;
    let pinched = false;
    let swallowClicksUntil = -Infinity;
    let wheelTurnUntil = -Infinity;

    const shown = () => shownWindow(useApp.getState().zoom, latestWhole.current);
    const startPress = (pointerId: number, start: Point, widthPx: number, touch: boolean, dragging: boolean) => {
      press = { pointerId, start, origin: shown(), widthPx, touch, dragging };
    };

    const wheel = (event: WheelEvent) => {
      const track = wheelTrack(event.target);
      if (!track || !element.contains(track)) return;
      const box = track.getBoundingClientRect();
      const window = shown();
      const next = wheelWindow(event, event.clientX - box.left, box.width, window, latestWhole.current);
      const turning = event.timeStamp < wheelTurnUntil;
      // A fresh zoom turn that cannot go further leaves the wheel to the page; a sideways swipe never navigates back.
      if (!turning && (!next || (sameWindow(next, window) && !wheelPans(event)))) return;
      event.preventDefault();
      wheelTurnUntil = event.timeStamp + WHEEL_TURN_MS;
      if (next) setZoom(next);
    };

    const startPinch = (box: DOMRect) => {
      const ids = [...touches.keys()].slice(0, 2) as [number, number];
      const [a, b] = ids.map((id) => (touches.get(id)?.x ?? 0) - box.left);
      pinch = { ids, origin: shown(), from: [a, b], leftPx: box.left, widthPx: box.width };
      if (press?.dragging) setGrabbing(false);
      press = null;
    };

    const down = (event: PointerEvent) => {
      swallowClicksUntil = -Infinity;
      const track = laneTrack(event.target);
      if (!track || (event.pointerType === 'mouse' && event.button !== 0)) return;
      const at = { x: event.clientX, y: event.clientY };
      const box = track.getBoundingClientRect();
      if (event.pointerType === 'touch') {
        // The primary touch is the first finger down: a finger whose release never arrived must not turn this drag into a pinch.
        if (event.isPrimary) {
          touches.clear();
          pinch = null;
          pinched = false;
        }
        touches.set(event.pointerId, at);
        if (touches.size === 2) startPinch(box);
        if (touches.size > 1) return;
      }
      startPress(event.pointerId, at, box.width, event.pointerType !== 'mouse', false);
    };

    const finish = (event: PointerEvent, clickFollows: boolean) => {
      touches.delete(event.pointerId);
      const swallowClick = () => {
        if (clickFollows) swallowClicksUntil = event.timeStamp + GESTURE_CLICK_MS;
      };
      if (pinch?.ids.includes(event.pointerId)) {
        const rest = pinch.ids.find((id) => id !== event.pointerId) ?? -1;
        const at = touches.get(rest);
        const { widthPx } = pinch;
        pinch = null;
        pinched = true;
        if (at) startPress(rest, at, widthPx, true, true);
      }
      if (pinched && touches.size === 0) {
        pinched = false;
        swallowClick();
      }
      if (!press || event.pointerId !== press.pointerId) return;
      if (press.dragging) {
        swallowClick();
        setGrabbing(false);
      }
      press = null;
    };

    const move = (event: PointerEvent) => {
      const at = { x: event.clientX, y: event.clientY };
      if (touches.has(event.pointerId)) touches.set(event.pointerId, at);
      if (pinch) {
        if (!pinch.ids.includes(event.pointerId)) return;
        const { ids, leftPx } = pinch;
        const [a, b] = ids.map((id) => (touches.get(id)?.x ?? leftPx) - leftPx);
        setZoom(pinchWindow(pinch.origin, pinch.from, [a, b], pinch.widthPx, latestWhole.current));
        return;
      }
      if (!press || event.pointerId !== press.pointerId) return;
      if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
        finish(event, false);
        return;
      }
      const dx = at.x - press.start.x;
      if (!press.dragging) {
        const gesture = pressGesture(dx, at.y - press.start.y, press.touch);
        if (gesture === 'click') return;
        if (gesture === 'scroll') {
          press = null;
          return;
        }
        press.dragging = true;
        element.setPointerCapture(event.pointerId);
        setGrabbing(true);
      }
      setZoom(grabWindow(press.origin, dx, press.widthPx, latestWhole.current));
    };

    const up = (event: PointerEvent) => finish(event, true);
    const cancel = (event: PointerEvent) => finish(event, false);
    // Fires on the mark that held a touch's implicit capture too; only the body's own capture ends a drag.
    const lostCapture = (event: PointerEvent) => {
      if (event.target === element) finish(event, false);
    };

    const dragStart = (event: DragEvent) => {
      if (laneTrack(event.target)) event.preventDefault();
    };

    const click = (event: MouseEvent) => {
      if (event.timeStamp > swallowClicksUntil) return;
      swallowClicksUntil = -Infinity;
      event.stopPropagation();
      event.preventDefault();
    };

    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('pointerdown', down);
    element.addEventListener('lostpointercapture', lostCapture);
    element.addEventListener('dragstart', dragStart);
    element.addEventListener('click', click, true);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    return () => {
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('lostpointercapture', lostCapture);
      element.removeEventListener('dragstart', dragStart);
      element.removeEventListener('click', click, true);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
    };
  }, [body, setZoom]);

  return grabbing;
}
