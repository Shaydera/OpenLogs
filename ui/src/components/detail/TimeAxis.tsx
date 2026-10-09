import { rangeTicks } from '../player/chartGeometry';

/**
 * The time axis under a detail chart, as wide as the chart: ticks centred on their time, only a tick
 * at the very left edge (0:00 of a whole pull) left-aligned. `flush` drops the top margin.
 */
export function TimeAxis({ startMs, endMs, flush = false }: { startMs: number; endMs: number; flush?: boolean }) {
  return (
    <div className={flush ? 'axis axis-flush' : 'axis'} aria-hidden="true">
      {rangeTicks(startMs, endMs).map((tick) => (
        <span key={tick.label} className={tick.leftPct === 0 ? 'num axis-start' : 'num'} style={{ left: `${tick.leftPct}%` }}>
          {tick.label}
        </span>
      ))}
    </div>
  );
}
