import type { Kpis, Phase } from '../../api/types';
import {
  formatAmount,
  formatDuration,
  formatEventTime,
  formatInteger,
  formatPercent,
  formatSignedAmount,
  formatSignedDuration,
  formatSignedInteger,
} from '../../i18n/format';
import type { MessageKey } from '../../i18n/i18n';
import { t } from '../../i18n/i18n';
import type { PullView } from '../../pulls/groupPulls';
import { phaseLabel } from '../overview/timelineGeometry';

const DASH = '—';

/** One key figure of both pulls and the difference B − A, formatted. */
export interface KpiRow {
  label: MessageKey;
  a: string;
  b: string;
  delta: string;
}

/** Start of one phase in both pulls; `null` where a pull did not have it. */
export interface PhaseRow {
  label: string;
  a: number | null;
  b: number | null;
}

/** The key figures of both pulls with the difference B − A. */
export function kpiRows(a: Kpis, b: Kpis): KpiRow[] {
  const count = (label: MessageKey, x: number, y: number): KpiRow => ({
    label,
    a: formatInteger(x),
    b: formatInteger(y),
    delta: formatSignedInteger(y - x),
  });
  const firstDeath = (kpis: Kpis) => (kpis.firstDeathMs === null ? DASH : formatEventTime(kpis.firstDeathMs));
  return [
    { label: 'pulls.column.duration', a: formatDuration(a.durationMs), b: formatDuration(b.durationMs), delta: durationDelta(a.durationMs, b.durationMs) },
    { label: 'kpi.raidDps', a: formatAmount(a.raidDps), b: formatAmount(b.raidDps), delta: formatSignedAmount(b.raidDps - a.raidDps) },
    {
      label: 'compare.raidDamage',
      a: formatAmount(a.raidDamage),
      b: formatAmount(b.raidDamage),
      delta: formatSignedAmount(b.raidDamage - a.raidDamage),
    },
    count('kpi.deaths', a.deaths, b.deaths),
    {
      label: 'compare.firstDeath',
      a: firstDeath(a),
      b: firstDeath(b),
      delta: a.firstDeathMs === null || b.firstDeathMs === null ? DASH : durationDelta(a.firstDeathMs, b.firstDeathMs),
    },
    count('kpi.combatPotions', a.combatPotions, b.combatPotions),
    count('compare.healthstones', a.healthstones, b.healthstones),
    count('compare.healthPotions', a.healthPotions, b.healthPotions),
  ];
}

/**
 * B − A of two times as the table shows them: whole seconds, so `2:22` and `5:09` differ by
 * `+2:47` even when the milliseconds would round the other way.
 */
export function durationDelta(aMs: number, bMs: number): string {
  return formatSignedDuration((Math.floor(bMs / 1000) - Math.floor(aMs / 1000)) * 1000);
}

/** Phase start times of both pulls, matched by phase name, in the order of their first start. */
export function phaseRows(a: Phase[], b: Phase[]): PhaseRow[] {
  const rows = new Map<string, PhaseRow>();
  const note = (phase: Phase, side: 'a' | 'b') => {
    const label = phaseLabel(phase);
    const row = rows.get(label) ?? { label, a: null, b: null };
    if (row[side] === null) row[side] = phase.startMs;
    rows.set(label, row);
  };
  a.forEach((phase) => note(phase, 'a'));
  b.forEach((phase) => note(phase, 'b'));
  const first = (row: PhaseRow) => Math.min(row.a ?? Infinity, row.b ?? Infinity);
  return [...rows.values()].sort((x, y) => first(x) - first(y));
}

/** Boss HP at the end: 0 % for a kill, else the indexed value or "—" (as in the pull list). */
export function endHpLabel(pull: PullView): string {
  if (pull.status === 'kill') return formatPercent(0);
  return pull.bossHpPercent !== null ? formatPercent(pull.bossHpPercent) : DASH;
}

/** "Pull #1 · Wipe · 2:22 · 60.4%" for the compare menu; a kill has no boss HP. */
export function pullOptionLabel(pull: PullView): string {
  return [
    t('compare.pull', { n: pull.n }),
    t(`status.${pull.status}`),
    formatDuration(pull.durationMs),
    pull.status === 'kill' ? null : endHpLabel(pull),
  ]
    .filter(Boolean)
    .join(' · ');
}
