import { Fragment, type ReactNode } from 'react';
import { type MessageKey, t } from '../../i18n/i18n';
import type { FilterTab } from '../../scopeSides';
import { type ViewToggles, useApp } from '../../store';
import { AuraKindSwitch } from '../auras/AuraKindSwitch';
import { ReportHead } from '../filters/ReportHead';

export const TAB_TITLE: Record<FilterTab, MessageKey> = {
  damage: 'tabs.damageDone',
  healing: 'tabs.healing',
  taken: 'tabs.damageTaken',
  deaths: 'tabs.deaths',
  casts: 'tabs.casts',
  buffs: 'tabs.buffs',
  interrupts: 'tabs.interrupts',
  resources: 'tabs.resources',
};

/** A view's head: the tab's pickers, the Buffs | Debuffs switch on Buffs & Debuffs, the view's own toggles and `extra`. */
export function ViewHead(props: { tab: FilterTab; id: string; title: string; summary?: ReactNode; toggles: (keyof ViewToggles)[]; extra?: ReactNode }) {
  const { tab, id, title, summary, toggles, extra } = props;
  const values = useApp((s) => s.viewToggles);
  const setViewToggle = useApp((s) => s.setViewToggle);
  return (
    <ReportHead
      tab={tab}
      id={id}
      title={title}
      summary={summary}
      tools={
        <>
          {tab === 'buffs' && <AuraKindSwitch />}
          {toggles.map((toggle) => {
            const hint = toggle === 'rejected' ? `${id}-${toggle}-hint` : undefined;
            return (
              <Fragment key={toggle}>
                <label className="chk" title={hint ? t('views.rejectedHint') : undefined}>
                  <input type="checkbox" checked={values[toggle]} aria-describedby={hint} onChange={() => void setViewToggle(toggle, !values[toggle])} />
                  {t(`views.${toggle}`)}
                </label>
                {hint && (
                  <span id={hint} className="sr-only">
                    {t('views.rejectedHint')}
                  </span>
                )}
              </Fragment>
            );
          })}
          {extra}
        </>
      }
    />
  );
}

/** Why a view failed, and a way to ask for the same page or window again. */
export function ViewFailure({ reason, retry }: { reason: string; retry?: boolean }) {
  const retryView = useApp((s) => s.retryView);
  return (
    <p className="muted pad" role="alert">
      {t('report.failed', { reason })}{' '}
      {retry && (
        <button type="button" className="lnk" onClick={() => void retryView()}>
          {t('view.retry')}
        </button>
      )}
    </p>
  );
}
