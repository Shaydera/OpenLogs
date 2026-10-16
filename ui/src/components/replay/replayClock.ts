import type { ReplaySpeed } from '../../store';

let base = 0;
let startedAt = 0;
let running = false;
let speed: ReplaySpeed = 1;

const now = () => (running ? base + (performance.now() - startedAt) * speed : base);

export const replayClock = {
  now,
  play() {
    if (running) return;
    startedAt = performance.now();
    running = true;
  },
  pause() {
    base = now();
    running = false;
  },
  seek(ms: number) {
    base = ms;
    startedAt = performance.now();
  },
  setSpeed(s: ReplaySpeed) {
    base = now();
    startedAt = performance.now();
    speed = s;
  },
  playing: () => running,
};
