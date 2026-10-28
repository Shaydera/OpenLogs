import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { isUpdateShown } from '../../updateCheck';

export function UpdateNotice() {
  const update = useApp((s) => s.availableUpdate);
  const dismissed = useApp((s) => s.dismissedUpdate);
  const dismiss = useApp((s) => s.dismissUpdate);
  const showError = useApp((s) => s.showError);
  const shown = isUpdateShown(update, dismissed);

  async function viewRelease(url: string) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
    } catch (err) {
      showError(t('error.openReleaseFailed', { reason: String(err) }));
    }
  }

  // Screen readers announce changes inside a live region that is already there, not one mounted with its text;
  // the buttons stay outside it so they are not read out with the message.
  return (
    <div className={shown ? 'update-notice ui-scaled' : undefined}>
      <span role="status">{shown && t('update.available', { version: update.version })}</span>
      {shown && (
        <>
          <button type="button" className="btn btn-accent" onClick={() => void viewRelease(update.url)}>
            {t('update.viewRelease')}
          </button>
          <button type="button" className="dd-clear" aria-label={t('update.dismiss')} title={t('update.dismiss')} onClick={dismiss}>
            ×
          </button>
        </>
      )}
    </div>
  );
}
