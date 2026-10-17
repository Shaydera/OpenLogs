import { useApp } from '../../store';

/** The replay time for the HUD: exact on seek and pause, every 100 ms while playing. */
export function useReplayTime(): number {
  return useApp((s) => s.replay.time);
}
