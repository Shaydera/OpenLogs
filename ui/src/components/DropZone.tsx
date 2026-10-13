import { t } from '../i18n/i18n';
import type { Opening } from '../store';

interface Props {
  over: boolean;
  opening: Opening | null;
}

export function DropZone({ over, opening }: Props) {
  const percent = opening?.totalBytes ? Math.min(100, Math.round((opening.bytesRead / opening.totalBytes) * 100)) : null;
  return (
    <div className={over ? 'dropzone over' : 'dropzone'} role="status" aria-live="polite">
      <svg className="dropzone-icon" width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 4v11M7 10l5 5 5-5M5 19h14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="dropzone-title">{opening ? t('start.indexing', { file: opening.file }) : t('start.dropTitle')}</div>
      {percent !== null ? (
        <div className="dropzone-progress" role="progressbar" aria-label={t('start.progress')} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${percent}%` }} />
        </div>
      ) : (
        <div className="dropzone-hint">{t('start.dropHint')}</div>
      )}
    </div>
  );
}
