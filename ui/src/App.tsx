import { useEffect } from 'react';
import { FightView } from './components/FightView';
import { SettingsDialog } from './components/SettingsDialog';
import { StartPage } from './components/StartPage';
import { useAutoScale } from './hooks/useAutoScale';
import { useLogDrop } from './hooks/useLogDrop';
import { useZoomGestures } from './hooks/useZoomGestures';
import { t } from './i18n/i18n';
import { useApp } from './store';
import { applyTheme, followSystemScheme } from './theme';
import { applyUiScale, effectiveScale } from './uiScale';

export function App() {
  const refreshRecent = useApp((s) => s.refreshRecent);
  const openLog = useApp((s) => s.openLog);
  const error = useApp((s) => s.error);
  const dismissError = useApp((s) => s.dismissError);
  const view = useApp((s) => s.view);
  const settingsOpen = useApp((s) => s.settingsOpen);
  const dragOver = useLogDrop(openLog);
  const theme = useApp((s) => s.theme);
  const themeMode = useApp((s) => s.themeMode);
  const uiSize = useApp((s) => s.uiSize);
  const auto = useAutoScale();
  useZoomGestures();

  useEffect(() => {
    void refreshRecent();
  }, [refreshRecent]);

  useEffect(() => {
    applyTheme(theme, themeMode);
    if (themeMode !== 'system') return;
    return followSystemScheme(() => applyTheme(theme, themeMode));
  }, [theme, themeMode]);

  useEffect(() => {
    applyUiScale(effectiveScale(auto, uiSize));
  }, [auto, uiSize]);

  return (
    <>
      {error && (
        <div role="alert" className="error-banner ui-scaled">
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
