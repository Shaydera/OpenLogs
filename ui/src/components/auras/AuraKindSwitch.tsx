import { t } from '../../i18n/i18n';
import { useApp } from '../../store';

const KINDS = ['buffs', 'debuffs'] as const;

/** Buffs or debuffs on the perspective's side: one control for the tab's table, timeline and events. */
export function AuraKindSwitch() {
  const kind = useApp((s) => s.auraKind);
  const setAuraKind = useApp((s) => s.setAuraKind);
  return (
    <div className="filters" role="group" aria-label={t('auras.kind')}>
      {KINDS.map((option) => (
        <button key={option} type="button" className={option === kind ? 'pill on' : 'pill'} aria-pressed={option === kind} onClick={() => void setAuraKind(option)}>
          {t(`auras.${option}`)}
        </button>
      ))}
    </div>
  );
}
