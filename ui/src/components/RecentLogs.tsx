import type { RecentLog } from '../api/types';
import { formatBytes, formatDateTime } from '../i18n/format';
import { t } from '../i18n/i18n';
import { logStartMs } from '../pulls/logStart';

interface Props {
  recent: RecentLog[];
  selectedId: string | null;
  onOpen: (entry: RecentLog) => void;
}

export function RecentLogs({ recent, selectedId, onOpen }: Props) {
  return (
    <section className="recent" aria-labelledby="recent-title">
      <h2 id="recent-title" className="cap section-label">
        {t('start.recentLogs')}
      </h2>
      {recent.length === 0 ? (
        <p className="recent-empty">{t('start.noRecent')}</p>
      ) : (
        <ul className="recent-list">
          {recent.map((log) => {
            const start = logStartMs(log.fileName, log.startUnixMs);
            return (
              <li key={log.id}>
                <button
                  type="button"
                  className={log.id === selectedId ? 'logbtn on' : 'logbtn'}
                  disabled={!log.exists}
                  onClick={() => onOpen(log)}
                >
                  <span className="num recent-file">{log.fileName}</span>
                  {log.exists ? (
                    <span className="recent-meta">
                      {start !== null && (
                        <>
                          <span>{formatDateTime(start)}</span>
                          <span aria-hidden="true">·</span>
                        </>
                      )}
                      <span>{formatBytes(log.sizeBytes)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{t('pulls.count', { count: log.pullCount })}</span>
                    </span>
                  ) : (
                    <span className="recent-missing">{t('start.chooseAgain')}</span>
                  )}
                  {log.zone && <span className="recent-zone">{log.zone}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
