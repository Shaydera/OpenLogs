import { t } from '../../i18n/i18n';

const ICONS = {
  table: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M9 4v16" /></svg>,
  timeline: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3 7h10M7 12h14M3 17h8" /></svg>,
  events: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>,
};

export function ViewSwitch() {
  return (
    <div className="seg view-switch" role="group" aria-label={t('view.label')}>
      {(['table', 'timeline', 'events'] as const).map((view) => (
        <button key={view} type="button" className={view === 'table' ? 'on' : undefined} aria-pressed={view === 'table'} disabled={view !== 'table'} title={view === 'table' ? undefined : t('view.soon')}>
          {ICONS[view]}
          <span>{t(`view.${view}`)}</span>
        </button>
      ))}
    </div>
  );
}
