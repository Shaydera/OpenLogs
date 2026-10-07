import { t } from '../i18n/i18n';

interface Props {
  over: boolean;
  busyFile: string | null;
}

export function DropZone({ over, busyFile }: Props) {
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
      <div className="dropzone-title">{busyFile ? t('start.indexing', { file: busyFile }) : t('start.dropTitle')}</div>
      <div className="dropzone-hint">{t('start.dropHint')}</div>
    </div>
  );
}
