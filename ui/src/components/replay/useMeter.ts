import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { MeterData } from '../../api/types';
import { type MeterMode, useApp } from '../../store';

const PLAYING_INTERVAL_MS = 250;
/** While playing, a forward step up to this long is playback; anything else is a seek and asks at once. */
const PLAYBACK_STEP_MS = 1_000;

type Span = { startMs: number; endMs: number };
type Answer = { data: MeterData | null; expanded: number | null; loading: boolean };

export function meterSpan(bounds: Span, t: number, mode: MeterMode, windowMs: number): Span {
  const endMs = Math.min(Math.max(t, bounds.startMs), bounds.endMs);
  return { startMs: mode === 'window' ? Math.max(bounds.startMs, endMs - windowMs) : bounds.startMs, endMs };
}

interface Pending {
  fetch: () => Promise<MeterData>;
  throttled: boolean;
  settle: (data: MeterData | null) => void;
}

class MeterQueue {
  /** Bumped by every change except playback steps: an answer started under an older generation no longer fits. */
  private generation = 0;
  private inFlight = false;
  private lastStart = -Infinity;
  private pending: Pending | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  request(fetch: () => Promise<MeterData>, throttled: boolean, settle: (data: MeterData | null) => void) {
    if (!throttled) this.generation += 1;
    this.pending = { fetch, throttled: throttled && (this.pending?.throttled ?? true), settle };
    this.pump();
  }

  cancel() {
    this.generation += 1;
    this.pending = null;
    this.clearTimer();
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private pump() {
    if (this.inFlight || this.pending === null) return;
    this.clearTimer();
    const wait = this.pending.throttled ? this.lastStart + PLAYING_INTERVAL_MS - performance.now() : 0;
    if (wait > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pump();
      }, wait);
      return;
    }
    const { fetch, settle } = this.pending;
    const generation = this.generation;
    this.pending = null;
    this.inFlight = true;
    this.lastStart = performance.now();
    Promise.resolve()
      .then(fetch)
      .then(
        (data) => generation === this.generation && settle(data),
        () => generation === this.generation && settle(null),
      )
      .finally(() => {
        this.inFlight = false;
        this.pump();
      });
  }
}

/** The meter for the replay time: the span up to now, re-asked while playing at most every 250 ms, at once on any other change. */
export function useMeter(fightIndex: number | null, bounds: Span, expand: number | null): { data: MeterData | null; loading: boolean } {
  const logId = useApp((s) => s.log?.id ?? null);
  const durationMs = useApp((s) => s.replayData?.durationMs ?? Infinity);
  const attribution = useApp((s) => s.attribution);
  const includeOverkill = useApp((s) => s.includeOverkill);
  const time = useApp((s) => s.replay.time);
  const playing = useApp((s) => s.replay.playing);
  const { category, mode, windowMs } = useApp((s) => s.replay.meter);
  const { startMs, endMs } = meterSpan(bounds, time, mode, windowMs);
  const [answer, setAnswer] = useState<Answer>({ data: null, expanded: null, loading: false });
  const queue = useRef<MeterQueue | null>(null);
  queue.current ??= new MeterQueue();
  const asked = useRef<{ key: string; endMs: number } | null>(null);

  useEffect(() => () => queue.current?.cancel(), []);

  useEffect(() => {
    const meterQueue = queue.current;
    if (!meterQueue) return;
    const key = JSON.stringify([logId, fightIndex, attribution, includeOverkill, category, mode, windowMs, expand, bounds.startMs, bounds.endMs]);
    const previous = asked.current;
    asked.current = { key, endMs };
    if (logId === null || fightIndex === null || endMs <= startMs) {
      meterQueue.cancel();
      setAnswer({ data: null, expanded: null, loading: false });
      return;
    }
    const step = previous?.key === key ? endMs - previous.endMs : -1;
    const playback = playing && step >= 0 && step <= PLAYBACK_STEP_MS;
    // A span reaching the pull's end stays open, as the reports send it, so the pull's last events count.
    const filter = { startMs, endMs: endMs >= durationMs ? null : endMs, attribution, includeOverkill };
    setAnswer((current) => (current.loading ? current : { ...current, loading: true }));
    meterQueue.request(
      () => api.replayMeter(logId, fightIndex, filter, category, expand),
      playback,
      (data) => setAnswer((current) => (data ? { data, expanded: expand, loading: false } : { ...current, loading: false })),
    );
  }, [logId, fightIndex, durationMs, attribution, includeOverkill, category, mode, windowMs, expand, bounds.startMs, bounds.endMs, startMs, endMs, playing]);

  const { data, expanded, loading } = answer;
  // Until the answer for a newly expanded player arrives, the last breakdown belongs to someone else.
  return { data: data && expanded !== expand ? { ...data, breakdown: [] } : data, loading };
}
