import { HEALTH } from '../../api/types';
import { classColor } from '../overview/players';

/** The resource plot's box. */
const WIDTH = 1000;
const HEIGHT = 160;

const round1 = (v: number) => Math.round(v * 10) / 10;
/** 100 % at y 8, 0 % at y 152 of 160: the line never touches the frame. */
const pctY = (pct: number) => round1(152 - pct * 1.44);

/**
 * Line and area of a power track over `[startMs, endMs)`: one point in the middle of each step
 * (a cut-off last step in the middle of what is left), broken where the value is unknown and where
 * the player was dead (`dead`, absolute times).
 */
export function resourcePaths(
  series: (number | null)[],
  stepMs: number,
  startMs: number,
  endMs: number,
  dead: [number, number][] = [],
): { line: string; area: string } {
  const len = endMs - startMs;
  if (len <= 0 || stepMs <= 0) return { line: '', area: '' };
  const middle = (i: number) => {
    const from = i * stepMs;
    return (from + Math.min(len, from + stepMs)) / 2;
  };
  const x = (i: number) => round1((middle(i) / len) * WIDTH);
  const isDead = (i: number) => dead.some(([a, b]) => startMs + middle(i) >= a && startMs + middle(i) < b);
  const segments: [number, number][][] = [];
  let current: [number, number][] = [];
  series.forEach((value, i) => {
    if (value === null || isDead(i)) {
      if (current.length > 0) segments.push(current);
      current = [];
    } else {
      current.push([x(i), pctY(value)]);
    }
  });
  if (current.length > 0) segments.push(current);
  const path = (seg: [number, number][]) =>
    seg.length === 1
      ? `M ${round1(seg[0][0] - 5)} ${seg[0][1]} L ${round1(seg[0][0] + 5)} ${seg[0][1]}`
      : seg.map(([px, py], i) => `${i === 0 ? 'M' : 'L'} ${px} ${py}`).join(' ');
  return {
    line: segments.map(path).join(' '),
    area: segments
      .filter((seg) => seg.length > 1)
      .map((seg) => `${path(seg)} L ${seg[seg.length - 1][0]} ${HEIGHT} L ${seg[0][0]} ${HEIGHT} Z`)
      .join(' '),
  };
}

/** Mana and health in their own colours; other powers in the player's class colour. */
export function powerColour(powerType: number, classToken: string | null): string {
  if (powerType === HEALTH) return 'var(--role-healer)';
  return powerType === 0 ? 'var(--mana)' : classColor(classToken);
}
