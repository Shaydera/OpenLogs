import { useId, useRef, useState } from 'react';
import type { Side } from '../../api/types';
import { useDismiss } from '../../hooks/useDismiss';
import { t } from '../../i18n/i18n';
import { effectiveView } from '../../reportViews';
import { type FightTab, useApp } from '../../store';

function augCreditApplies(tab: FightTab, perspective: Side, inDetail: boolean): boolean {
  if (inDetail) return tab === 'damage' || tab === 'healing';
  if (tab === 'damage' || tab === 'healing') return perspective === 'friendly';
  // Damage taken by enemies is the raid's damage regrouped, so it moves with the credit.
  return tab === 'taken' && perspective === 'enemy';
}

function optionsTitle(augOff: boolean, includeOverkill: boolean): string {
  if (augOff) return t('options.titleAugOff');
  if (includeOverkill) return t('options.titleOverkill');
  return t('options.title');
}

interface Option {
  label: string;
  checked: boolean;
  toggle: () => void;
  disabledBy?: string;
}

export function OptionsMenu() {
  const tab = useApp((s) => s.tab);
  const perspective = useApp((s) => s.scope.perspective);
  const inDetail = useApp((s) => s.details.length > 0);
  const attribution = useApp((s) => s.attribution);
  const setAttribution = useApp((s) => s.setAttribution);
  const includeOverkill = useApp((s) => s.includeOverkill);
  const setIncludeOverkill = useApp((s) => s.setIncludeOverkill);
  const showAugDelta = useApp((s) => s.showAugDelta);
  const setShowAugDelta = useApp((s) => s.setShowAugDelta);
  const colorByTarget = useApp((s) => s.colorByTarget);
  const setColorByTarget = useApp((s) => s.setColorByTarget);
  const hideProcs = useApp((s) => s.hideProcs);
  const setHideProcs = useApp((s) => s.setHideProcs);
  const view = useApp((s) => effectiveView(s.tab, s.details.length > 0, s.reportView));
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const augApplies = augCreditApplies(tab, perspective, inDetail);
  const metricTab = tab === 'damage' || tab === 'healing';
  const augOff = attribution !== 'reattributed';
  const changed = augOff || includeOverkill;
  const title = optionsTitle(augOff, includeOverkill);
  const table: Option[] = [];
  if (metricTab && view === 'table') {
    table.push({ label: t('options.augDelta'), checked: showAugDelta, toggle: () => setShowAugDelta(!showAugDelta) });
    table.push({ label: t('options.colorByTarget'), checked: colorByTarget, toggle: () => setColorByTarget(!colorByTarget) });
  }
  const casts: Option[] = [];
  if (tab === 'casts') {
    const disabledBy = perspective === 'enemy' ? t('options.procsOnlyPlayers') : undefined;
    casts.push({ label: t('options.hideProcs'), checked: hideProcs, toggle: () => void setHideProcs(!hideProcs), disabledBy });
  }
  const sections = [
    { title: t('options.table'), options: table },
    { title: t('options.casts'), options: casts },
  ].filter((section) => section.options.length > 0);
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
          <h3 className="cap options-head options-split">{t('options.allLogs')}</h3>
          <label className="options-row">
            <input type="checkbox" checked={includeOverkill} onChange={() => void setIncludeOverkill(!includeOverkill)} />
            <span>
              {t('options.overkill')}
              <span className="options-hint">{t('options.overkillHint')}</span>
            </span>
          </label>
          {sections.map((section) => (
            <section key={section.title} aria-label={section.title}>
              <h3 className="cap options-head options-split">{section.title}</h3>
              {section.options.map((o) => (
                <label key={o.label} className="options-row" title={o.disabledBy}>
                  <input type="checkbox" checked={o.checked} disabled={o.disabledBy !== undefined} onChange={o.toggle} />
                  <span>{o.label}</span>
                </label>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
