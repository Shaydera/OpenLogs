import { Fragment } from 'react';
import type { FightRow } from '../../api/types';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { type CrumbAction, fightCrumbs } from './crumbs';

/** The top bar of every fight screen: the app name back to the pull list and the breadcrumb. */
export function FightTopBar({ row }: { row: FightRow }) {
  const log = useApp((s) => s.log);
  const tab = useApp((s) => s.tab);
  const backToPulls = useApp((s) => s.backToPulls);
  if (!log) return null;
  const crumbs = fightCrumbs({ log, row, tab });

  function follow(action: CrumbAction) {
    switch (action.kind) {
      case 'pulls':
        return backToPulls();
    }
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
                <span className="crumb-current" aria-current="page">
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
    </header>
  );
}
