import { type MouseEvent, useMemo, useState } from 'react';
import type { PlayerRef, TimelineLane } from '../../api/types';
import { formatEventTimeMs, formatScaled, formatShare } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import type { TimeRange } from '../../store';
import { band } from '../player/chartGeometry';
import { powerName } from '../resources/powerNames';
import { LINE_BOX_HEIGHT, type Sample, lowestIn, powerArea, powerPath, sampleAt, sampleShare } from '../resources/powerLine';
import { powerColour } from '../resources/resourceGeometry';
import { timeAtX } from './zoomGeometry';

const describe = (sample: Sample) =>
  t('tl.power.value', { current: formatScaled(sample[1]), max: formatScaled(sample[2]), share: formatShare(sampleShare(sample) * 100) });

/** A unit's power and health in the window, one line each as logged, broken where it was dead. */
export function PowerLane({ lane, shown, player }: { lane: TimelineLane; shown: TimeRange; player: PlayerRef | undefined }) {
  const [hover, setHover] = useState<{ powerType: number; x: number; width: number } | null>(null);
  const lines = useMemo(
    () =>
      lane.power.map((line) => ({
        line,
        path: powerPath(line.samples, shown, lane.dead),
        area: powerArea(line.samples, shown, lane.dead),
        lowest: lowestIn(line.samples, shown),
      })),
    [lane.power, lane.dead, shown],
  );
  const bands = useMemo(
    () =>
      lane.dead.flatMap(([a, b]) => {
        const pos = band(a, b, shown.startMs, shown.endMs);
        return pos ? [{ key: a, ...pos }] : [];
      }),
    [lane.dead, shown],
  );
  const move = (powerType: number) => (event: MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setHover({ powerType, x: event.clientX - box.left, width: box.width });
  };
  return (
    <div className="tl-power">
      {lines.map(({ line, path, area, lowest }) => {
        const name = powerName(line.powerType);
        const hoverMs = hover?.powerType === line.powerType ? timeAtX(hover.x, hover.width, shown) : null;
        const at = hoverMs === null ? null : sampleAt(line.samples, hoverMs);
        const wasDead = hoverMs !== null && lane.dead.some(([a, b]) => a <= hoverMs && hoverMs < b);
        const label = lowest ? t('tl.power.label', { name, lowest: describe(lowest), time: formatEventTimeMs(lowest[0]) }) : name;
        return (
          <div key={line.powerType} className="tl-power-line">
            {bands.map((b) => (
              <div key={b.key} className="res-dead" style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }} aria-hidden="true" />
            ))}
            <svg
              viewBox={`0 0 1000 ${LINE_BOX_HEIGHT}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={label}
              style={{ color: powerColour(line.powerType, player?.classToken ?? null) }}
              onMouseMove={move(line.powerType)}
              onMouseLeave={() => setHover(null)}
            >
              {area && <path d={area} className="res-area" />}
              <path d={path} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            </svg>
            <span className="tl-power-name">{name}</span>
            {at && (
              <span className="tl-power-tip num" style={{ left: hover?.x }}>
                {t(wasDead ? 'tl.power.atDead' : 'tl.power.at', { name, value: describe(at), time: formatEventTimeMs(at[0]) })}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
