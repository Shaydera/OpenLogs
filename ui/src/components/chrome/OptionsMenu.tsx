import { useId, useRef, useState } from 'react';
import type { Side } from '../../api/types';
import { useDismiss } from '../../hooks/useDismiss';
import { t } from '../../i18n/i18n';
import { type FightTab, useApp } from '../../store';

function augCreditApplies(tab: FightTab, perspective: Side, inDetail: boolean): boolean {
  if (inDetail) return tab === 'damage' || tab === 'healing';
  if (tab === 'damage' || tab === 'healing') return perspective === 'friendly';
  // Damage taken by enemies is the raid's damage regrouped, so it moves with the credit.
  return tab === 'taken' && perspective === 'enemy';
}

export function OptionsMenu() {
  const tab = useApp((s) => s.tab);
  const perspective = useApp((s) => s.scope.perspective);
  const inDetail = useApp((s) => s.details.length > 0);
  const attribution = useApp((s) => s.attribution);
  const setAttribution = useApp((s) => s.setAttribution);
  const showAugDelta = useApp((s) => s.showAugDelta);
  const setShowAugDelta = useApp((s) => s.setShowAugDelta);
  const colorByTarget = useApp((s) => s.colorByTarget);
  const setColorByTarget = useApp((s) => s.setColorByTarget);
  const hideProcs = useApp((s) => s.hideProcs);
  const setHideProcs = useApp((s) => s.setHideProcs);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const augApplies = augCreditApplies(tab, perspective, inDetail);
  const metricTab = tab === 'damage' || tab === 'healing';
  const changed = attribution !== 'reattributed';
  const title = changed ? t('options.titleAugOff') : t('options.title');
  const table: { label: string; checked: boolean; toggle: () => void; disabledBy?: string }[] = [];
  if (metricTab) {
    table.push({ label: t('options.augDelta'), checked: showAugDelta, toggle: () => setShowAugDelta(!showAugDelta) });
    table.push({ label: t('options.colorByTarget'), checked: colorByTarget, toggle: () => setColorByTarget(!colorByTarget) });
  }
  if (tab === 'casts') {
    const disabledBy = perspective === 'enemy' ? t('options.procsOnlyPlayers') : undefined;
    table.push({ label: t('options.hideProcs'), checked: hideProcs, toggle: () => void setHideProcs(!hideProcs), disabledBy });
  }
  useDismiss(root, open, {
    onDismiss: () => setOpen(false),
    onEscape: () => {
      setOpen(false);
      button.current?.focus();
    },
  });

  return (
    <div ref={root} className="options">
      <button ref={button} type="button" className="dd options-btn" aria-label={title} title={title} aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(!open)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>
        {t('options.label')}
        {changed && <span className="options-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div id={menuId} className="options-pop" role="dialog" aria-label={t('options.label')}>
          <h3 className="cap options-head">{t('options.thisPull')}</h3>
          <label className="options-row" title={augApplies ? undefined : t('options.augOnlyMetric')}>
            <input type="checkbox" checked={attribution === 'reattributed'} disabled={!augApplies} onChange={() => void setAttribution(attribution === 'reattributed' ? 'augmented' : 'reattributed')} />
            <span>
              {t('options.augCredit')}
              <span className="options-hint">{t('options.augCreditHint')}</span>
            </span>
          </label>
          {table.length > 0 && <h3 className="cap options-head options-split">{t('options.table')}</h3>}
          {table.map((o) => (
            <label key={o.label} className="options-row" title={o.disabledBy}>
              <input type="checkbox" checked={o.checked} disabled={o.disabledBy !== undefined} onChange={o.toggle} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
