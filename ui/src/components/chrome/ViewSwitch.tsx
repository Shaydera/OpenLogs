import { Fragment, useId } from 'react';
import type { ReportView } from '../../api/types';
import { t } from '../../i18n/i18n';
import { effectiveView, unavailableReason } from '../../reportViews';
import { useApp } from '../../store';

const ICONS = {
  table: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M9 4v16" /></svg>,
  timeline: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3 7h10M7 12h14M3 17h8" /></svg>,
  events: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>,
};

const ORDER: ReportView[] = ['table', 'timeline', 'events'];

/** Table, Timeline and Events of the shown tab; a view the tab has not stays focusable, disabled with the reason. */
export function ViewSwitch() {
  const tab = useApp((s) => s.tab);
  const inDetail = useApp((s) => s.details.length > 0);
  const chosen = useApp((s) => s.reportView);
  const setReportView = useApp((s) => s.setReportView);
  const shown = effectiveView(tab, inDetail, chosen);
  const id = useId();
  return (
    <div className="seg view-switch" role="group" aria-label={t('view.label')}>
      {ORDER.map((view) => {
        const reason = unavailableReason(tab, inDetail, view);
        const reasonId = `${id}-${view}`;
        return (
          <Fragment key={view}>
            <button
              type="button"
              className={view === shown ? 'on' : undefined}
              aria-pressed={view === shown}
              aria-disabled={reason !== undefined || undefined}
              aria-describedby={reason !== undefined ? reasonId : undefined}
              title={reason}
              onClick={() => reason === undefined && view !== shown && void setReportView(view)}
            >
              {ICONS[view]}
              <span>{t(`view.${view}`)}</span>
            </button>
            {reason !== undefined && (
              <span id={reasonId} className="sr-only">
                {reason}
              </span>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
