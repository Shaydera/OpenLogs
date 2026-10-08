import type { ReactNode } from 'react';

/** Value tones: deaths, Aug support. */
export type KpiTone = 'death' | 'support';

/** One figure of a KPI strip: label, value and an optional sub-line. */
export function Kpi({
  label,
  value,
  sub,
  tone,
  subTone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: KpiTone;
  subTone?: 'warn';
}) {
  return (
    <div className="kpi">
      <span className="cap">{label}</span>
      <b className={tone ? `kpi-${tone}` : undefined}>{value}</b>
      {sub && <span className={subTone ? `kpi-sub kpi-sub-${subTone}` : 'kpi-sub'}>{sub}</span>}
    </div>
  );
}

/** One panel with the figures side by side. `large` is the Overview header's. */
export function KpiStrip({ label, large = false, children }: { label: string; large?: boolean; children: ReactNode }) {
  const className = ['panel', 'kpi-strip', large ? 'kpi-strip-lg' : null].filter(Boolean).join(' ');
  return (
    <section className={className} aria-label={label}>
      {children}
    </section>
  );
}
