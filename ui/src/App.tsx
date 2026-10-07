import { useEffect } from 'react';
import { FightView } from './components/FightView';
import { SettingsDialog } from './components/SettingsDialog';
import { StartPage } from './components/StartPage';
import { useLogDrop } from './hooks/useLogDrop';
import { t } from './i18n/i18n';
import { useApp } from './store';

export function App() {
  const refreshRecent = useApp((s) => s.refreshRecent);
  const openLog = useApp((s) => s.openLog);
  const error = useApp((s) => s.error);
  const dismissError = useApp((s) => s.dismissError);
  const view = useApp((s) => s.view);
  const settingsOpen = useApp((s) => s.settingsOpen);
  const dragOver = useLogDrop(openLog);

  useEffect(() => {
    void refreshRecent();
  }, [refreshRecent]);

  return (
    <>
      {error && (
        <div role="alert" className="error-banner">
          <span>{error}</span>
          <button type="button" className="btn" onClick={dismissError}>
            {t('error.dismiss')}
          </button>
        </div>
      )}
      {view.kind === 'fight' ? <FightView /> : <StartPage dragOver={dragOver} />}
      {settingsOpen && <SettingsDialog />}
    </>
  );
}
