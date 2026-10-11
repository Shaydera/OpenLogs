import { t } from '../../i18n/i18n';
import { useApp } from '../../store';

/** Hides curated procs and passive triggers in the Casts tab. */
export function HideProcsToggle() {
  const hideProcs = useApp((s) => s.hideProcs);
  const setHideProcs = useApp((s) => s.setHideProcs);
  return (
    <label className="toggle toggle-sm">
      <input type="checkbox" checked={hideProcs} onChange={(event) => setHideProcs(event.target.checked)} />
      {t('casts.hideProcs')}
    </label>
  );
}
