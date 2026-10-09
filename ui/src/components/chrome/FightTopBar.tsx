import { Fragment, type RefObject, useRef } from 'react';
import type { FightRow } from '../../api/types';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { type CrumbAction, fightCrumbs } from './crumbs';
import { RangeChip } from './RangeChip';

/**
 * The top bar of every fight screen: the app name back to the pull list, the breadcrumb and the range
 * pill on a ranged detail page. `currentRef` gets the last level: the focus target of a page without
 * a title.
 */
export function FightTopBar({ row, currentRef }: { row: FightRow; currentRef?: RefObject<HTMLSpanElement | null> }) {
  const log = useApp((s) => s.log);
  const tab = useApp((s) => s.tab);
  const details = useApp((s) => s.details);
  const overview = useApp((s) => s.overview);
  const report = useApp((s) => s.report);
  const backToPulls = useApp((s) => s.backToPulls);
  const setTab = useApp((s) => s.setTab);
  const showDetailAt = useApp((s) => s.showDetailAt);
  const range = useApp((s) => s.range);
  const setRange = useApp((s) => s.setRange);
  const current = useRef<HTMLSpanElement | null>(null);
  if (!log) return null;
  const crumbs = fightCrumbs({ log, row, tab, details, overview, report });

  function follow(action: CrumbAction) {
    switch (action.kind) {
      case 'pulls':
        return backToPulls();
      case 'overview':
        // The clicked crumb turns into plain text: focus the Overview title instead.
        return void setTab('overview', 'fight');
      case 'detail':
        return void showDetailAt(action.depth);
    }
  }

  function clearRange() {
    // The pill leaves with the range: focus stays in the bar, on the page shown.
    current.current?.focus();
    void setRange(null);
  }

  return (
    <header className="appbar">
      <button type="button" className="appbar-home" aria-label={t('chrome.home')} onClick={backToPulls}>
        <span className="appbar-brand">{t('app.name')}</span>
      </button>
      <nav className="crumbs" aria-label={t('chrome.breadcrumb')}>
        {crumbs.map((crumb, i) => {
          const action = crumb.action;
          return (
            <Fragment key={`${i}-${crumb.label}`}>
              {i > 0 && <span aria-hidden="true">›</span>}
              {crumb.current ? (
                <span
                  ref={(element) => {
                    current.current = element;
                    if (currentRef) currentRef.current = element;
                  }}
                  tabIndex={-1}
                  className="crumb-current"
                  aria-current="page"
                >
                  {crumb.label}
                </span>
              ) : action ? (
                <button type="button" className="crumb-link" onClick={() => follow(action)}>
                  {crumb.label}
                </button>
              ) : (
                <span>{crumb.label}</span>
              )}
            </Fragment>
          );
        })}
      </nav>
      <div className="appbar-end">
        {details.length > 0 && range !== null && <RangeChip range={range} onClear={clearRange} />}
      </div>
    </header>
  );
}
