import { type CSSProperties, type MouseEvent, useLayoutEffect, useRef, useState } from 'react';
import type { RecentLog } from '../api/types';
import { cssZoom } from '../cssZoom';
import { useDismiss } from '../hooks/useDismiss';
import { formatBytes, formatDateTime } from '../i18n/format';
import { t } from '../i18n/i18n';
import { logStartMs } from '../pulls/logStart';

interface Props {
  recent: RecentLog[];
  selectedId: string | null;
  onOpen: (entry: RecentLog) => void;
  onRemove: (entry: RecentLog) => void;
}

interface MenuAt {
  id: string;
  x: number;
  y: number;
}

export function RecentLogs({ recent, selectedId, onOpen, onRemove }: Props) {
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const openMenu = (event: MouseEvent<HTMLLIElement>, log: RecentLog) => {
    event.preventDefault();
    const row = event.currentTarget;
    const box = row.getBoundingClientRect();
    const zoom = cssZoom(row);
    const y = Math.min(Math.max(event.clientY, box.top), box.bottom);
    setMenu({ id: log.id, x: (event.clientX - box.left) / zoom, y: (y - box.top) / zoom });
  };

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
            const removeLabel = t('start.removeRecent', { file: log.fileName });
            return (
              <li key={log.id} className="recent-item" onContextMenu={(event) => openMenu(event, log)}>
                <button
                  type="button"
                  className={log.id === selectedId ? 'logbtn on' : 'logbtn'}
                  aria-disabled={log.exists ? undefined : true}
                  onClick={() => {
                    if (log.exists) onOpen(log);
                  }}
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
                <button type="button" className="dd-clear recent-remove" aria-label={removeLabel} title={removeLabel} onClick={() => onRemove(log)}>
                  ×
                </button>
                {menu?.id === log.id && (
                  <RecentMenu
                    key={`${menu.x},${menu.y}`}
                    log={log}
                    x={menu.x}
                    y={menu.y}
                    onRemove={() => {
                      setMenu(null);
                      onRemove(log);
                    }}
                    onClose={() => setMenu(null)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface MenuProps {
  log: RecentLog;
  x: number;
  y: number;
  onRemove: () => void;
  onClose: () => void;
}

function RecentMenu({ log, x, y, onRemove, onClose }: MenuProps) {
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, true, {
    onDismiss: onClose,
    onEscape: () => {
      const row = root.current?.closest('li')?.querySelector<HTMLButtonElement>('.logbtn');
      onClose();
      row?.focus();
    },
  });
  const [above, setAbove] = useState(false);
  useLayoutEffect(() => {
    const box = root.current?.getBoundingClientRect();
    if (box && box.bottom > window.innerHeight) setAbove(true);
  }, []);
  const keepOpenHere = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <div ref={root} className={above ? 'recent-menu recent-menu-above' : 'recent-menu'} role="menu" onContextMenu={keepOpenHere} aria-label={t('start.recentMenu', { file: log.fileName })} style={{ '--menu-x': `${x}px`, top: y } as CSSProperties}>
      <button type="button" role="menuitem" className="recent-menu-item" autoFocus onClick={onRemove}>
        {t('start.removeFromList')}
      </button>
    </div>
  );
}
