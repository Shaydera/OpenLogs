import { useEffect } from 'react';
import { useApp } from '../store';
import { UI_SIZES } from '../uiScale';

const STEP = 10;
const WHEEL_STEP_PX = 100;
const WHEEL_IDLE_MS = 200;
const LINE_PX = 16;
const PAGE_PX = 800;
const MIN_SIZE = UI_SIZES[0];
const MAX_SIZE = UI_SIZES[UI_SIZES.length - 1];

const ZOOM_IN_KEYS = ['+', '=', 'Add'];
const ZOOM_OUT_KEYS = ['-', 'Subtract'];

function stepSize(direction: 1 | -1) {
  const { uiSize, setUiSize } = useApp.getState();
  const next = Math.min(MAX_SIZE, Math.max(MIN_SIZE, uiSize + direction * STEP));
  if (next !== uiSize) setUiSize(next);
}

/** Maps the browser zoom gestures (Ctrl +, -, 0 and Ctrl + wheel or pinch) onto the UI size. */
export function useZoomGestures() {
  useEffect(() => {
    let wheelSum = 0;
    let lastWheelAt = 0;

    // Bubble phase: a component that already used the gesture (the timeline's pinch zoom) has called preventDefault.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (ZOOM_IN_KEYS.includes(event.key)) stepSize(1);
      else if (ZOOM_OUT_KEYS.includes(event.key)) stepSize(-1);
      else if (event.key === '0') useApp.getState().setUiSize(100);
      else return;
      event.preventDefault();
    };

    // A pinch arrives as many small Ctrl + wheel deltas; summing them keeps it from racing through the range.
    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.deltaY === 0) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? PAGE_PX : 1;
      const delta = event.deltaY * unit;
      // A leftover partial sum must not carry into a later gesture or the opposite direction.
      if (event.timeStamp - lastWheelAt > WHEEL_IDLE_MS || Math.sign(delta) !== Math.sign(wheelSum)) wheelSum = 0;
      lastWheelAt = event.timeStamp;
      wheelSum += delta;
      if (Math.abs(wheelSum) < WHEEL_STEP_PX) return;
      stepSize(wheelSum < 0 ? 1 : -1);
      wheelSum = 0;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('wheel', onWheel);
    };
  }, []);
}
