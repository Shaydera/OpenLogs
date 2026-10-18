import { t } from '../../i18n/i18n';
import { replayOffered, useApp } from '../../store';
import { ViewLens } from '../filters/ViewLens';
import { OptionsMenu } from './OptionsMenu';
import { ViewSwitch } from './ViewSwitch';

/** The row under the tabs: whose view and which source at the start, the options menu, view switch and replay toggle at the end; the replay has none of them, a whole Mythic+ run no replay. */
export function ReportToolbar() {
  const tab = useApp((s) => s.tab);
  const withReplay = useApp(replayOffered);
  const split = useApp((s) => s.replay.split);
  const setReplaySplit = useApp((s) => s.setReplaySplit);
  if (tab === 'replay') return null;
  return (
    <div className="report-toolbar" role="toolbar" aria-label={t('toolbar.label')}>
      <ViewLens />
      <span className="report-toolbar-spacer" />
      <OptionsMenu />
      <ViewSwitch />
      {withReplay && (
        <button type="button" className={split ? 'split-toggle on' : 'split-toggle'} aria-pressed={split} onClick={() => setReplaySplit(!split)}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 2.5 V13.5" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          {t('replay.alongside')}
        </button>
      )}
    </div>
  );
}
