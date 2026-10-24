import { useEffect } from 'react';
import { formatInteger, formatShare } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import type { LiveNotice as Notice } from '../../pulls/follow';
import { useApp } from '../../store';

const NOTICE_MS = 4000;

function message(notice: Notice): string {
  if (notice.kind === 'run') {
    return t('live.runLoaded', {
      dungeon: notice.dungeon,
      level: formatInteger(notice.keystoneLevel),
      result: t(`runs.status.${notice.status}`),
    });
  }
  const label = t(`status.${notice.status}`);
  const result = notice.status === 'wipe' && notice.bossHpPercent !== null ? `${label} ${formatShare(notice.bossHpPercent)}` : label;
  return t('live.pullLoaded', { n: notice.n, result });
}

export function LiveNotice() {
  const notice = useApp((s) => s.liveNotice);
  const dismiss = useApp((s) => s.dismissLiveNotice);
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(dismiss, NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, dismiss]);
  // Screen readers announce changes inside a live region that is already there, not one mounted with its text.
  return <div role="status">{notice !== null && <div className="live-notice ui-scaled">{message(notice)}</div>}</div>;
}
