import type { Attribution } from '../../api/types';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';

const MODES: Attribution[] = ['augmented', 'reattributed'];

export function AttributionToggle() {
  const attribution = useApp((s) => s.attribution);
  const setAttribution = useApp((s) => s.setAttribution);
  const tab = useApp((s) => s.tab);
  const label = t(tab === 'healing' ? 'aug.labelHealing' : 'aug.label');
  return (
    <div className="seg-wrap">
      <span className="cap" aria-hidden="true">
        {label}
      </span>
      <div className="seg" role="group" aria-label={label}>
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            className={mode === attribution ? 'on' : undefined}
            aria-pressed={mode === attribution}
            onClick={() => void setAttribution(mode)}
          >
            {t(`aug.${mode}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
