import { type ReactNode, useId, useState } from 'react';
import { formatAmount, formatPercent } from '../../i18n/format';
import { t } from '../../i18n/i18n';

interface HudPanelProps {
  label: string;
  className: string;
  defaultCollapsed?: boolean;
  /** Hides the panel but keeps it mounted, so it comes back as collapsed or expanded as it was. */
  hidden?: boolean;
  /** Puts the caption under the body, in one row with `captionAside` while expanded. */
  captionBelow?: boolean;
  captionAside?: ReactNode;
  children: ReactNode;
}

/** A HUD overlay whose caption collapses it to just the caption. */
export function HudPanel({ label, className, defaultCollapsed = false, hidden = false, captionBelow = false, captionAside, children }: HudPanelProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const bodyId = useId();
  const toggle = (
    <button type="button" className="hud-toggle" aria-expanded={!collapsed} aria-controls={collapsed ? undefined : bodyId} onClick={() => setCollapsed(!collapsed)}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M3 4.5 L6 7.5 L9 4.5" />
      </svg>
      {label}
    </button>
  );
  return (
    <section className={collapsed ? `hud ${className} collapsed` : `hud ${className}`} aria-label={label} hidden={hidden}>
      {!captionBelow && toggle}
      {!collapsed && (
        <div id={bodyId} className="hud-body">
          {children}
        </div>
      )}
      {captionBelow && (
        <div className="hud-caption-row">
          {toggle}
          {!collapsed && captionAside}
        </div>
      )}
    </section>
  );
}

export function healthText(health: { current: number; percent: number | null }): string {
  const amount = formatAmount(health.current);
  return health.percent === null ? amount : t('replay.healthValue', { amount, percent: formatPercent(health.percent) });
}

type HealthTone = 'boss' | 'add' | 'unit';

/** A health bar; `percent` is `null` before the unit's first health sample. */
export function HealthBar({ percent, tone }: { percent: number | null; tone: HealthTone }) {
  const width = Math.min(100, Math.max(0, percent ?? 0));
  return (
    <div
      className={`hud-hp hud-hp-${tone}`}
      role="meter"
      aria-label={t('replay.health')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent === null ? undefined : Math.round(percent * 10) / 10}
      aria-valuetext={percent === null ? undefined : formatPercent(percent)}
    >
      <span style={{ width: `${width}%` }} />
    </div>
  );
}
