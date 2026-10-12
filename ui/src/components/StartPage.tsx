import { open } from '@tauri-apps/plugin-dialog';
import { useMemo, useRef } from 'react';
import { useFocusRequest } from '../hooks/useFocusRequest';
import type { LogView } from '../api/types';
import { formatBytes, formatDateTime } from '../i18n/format';
import { t } from '../i18n/i18n';
import { groupPulls, groupRuns } from '../pulls/groupPulls';
import { logStartMs } from '../pulls/logStart';
import { useApp } from '../store';
import { ThemeSwitch } from './chrome/ThemeSwitch';
import { DropZone } from './DropZone';
import { PullList, RunCards } from './PullList';
import { RecentLogs } from './RecentLogs';

export function StartPage({ dragOver }: { dragOver: boolean }) {
  const recent = useApp((s) => s.recent);
  const log = useApp((s) => s.log);
  const openingFile = useApp((s) => s.openingFile);
  const openLog = useApp((s) => s.openLog);
  const showError = useApp((s) => s.showError);
  const openSettings = useApp((s) => s.openSettings);

  async function chooseLog() {
    let selected: unknown;
    try {
      selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: t('start.dialogFilter'), extensions: ['txt'] }],
      });
    } catch (err) {
      showError(t('error.dialogFailed', { reason: String(err) }));
      return;
    }
    if (typeof selected === 'string') await openLog(selected);
  }

  return (
    <div>
      <header className="topbar brand-island">
        <div className="brand-row">
          <div className="brand">{t('app.name')}</div>
          <div className="tagline">{t('app.tagline')}</div>
        </div>
        <div className="topbar-actions">
          <ThemeSwitch />
          <button type="button" className="btn" onClick={() => void openSettings()}>
            {t('settings.open')}
          </button>
          <button type="button" className="btn btn-accent" onClick={() => void chooseLog()}>
            {t('start.openLog')}
          </button>
        </div>
      </header>
      <div className="layout">
        <aside className="sidebar">
          <DropZone over={dragOver} busyFile={openingFile} />
          <RecentLogs recent={recent} selectedPath={log?.path ?? null} onOpen={(path) => void openLog(path)} />
        </aside>
        <main className="content">{log ? <LogPulls log={log} /> : <EmptyState title={t('start.emptyTitle')} text={t('start.empty')} />}</main>
      </div>
    </div>
  );
}

function LogPulls({ log }: { log: LogView }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useFocusRequest('start', () => titleRef.current);
  const hideAborted = useApp((s) => s.hideAborted);
  const setHideAborted = useApp((s) => s.setHideAborted);
  const openFight = useApp((s) => s.openFight);
  const groups = useMemo(() => groupPulls(log.fights, hideAborted), [log.fights, hideAborted]);
  const runs = useMemo(() => groupRuns(log.fights, hideAborted), [log.fights, hideAborted]);
  const start = logStartMs(log.fileName, log.startUnixMs);
  const heading = [log.zone, start !== null ? formatDateTime(start) : null].filter(Boolean).join(' · ');
  const bothKinds = runs.length > 0 && groups.length > 0;

  return (
    <>
      <div className="log-head">
        <div className="log-id">
          {heading && <div className="cap">{heading}</div>}
          <h1 ref={titleRef} tabIndex={-1} className="num log-title">{log.fileName}</h1>
          <div className="log-meta">
            {t('log.meta', {
              version: log.logVersion ?? t('log.unknown'),
              advanced: log.advancedLogging ? t('log.on') : t('log.off'),
              build: log.build ?? t('log.unknown'),
              size: formatBytes(log.sizeBytes),
            })}
          </div>
          {log.warnings.map((warning) => (
            <p key={warning} className="warning">
              {warning}
            </p>
          ))}
          {log.brokenLines > 0 && <p className="warning">{t('log.skippedLines', { count: log.brokenLines })}</p>}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={hideAborted} onChange={(event) => setHideAborted(event.target.checked)} />
          {t('pulls.hideAborted')}
        </label>
      </div>
      {bothKinds && <h2 className="cap section-label">{t('runs.title')}</h2>}
      {runs.length > 0 && <RunCards runs={runs} onOpen={(index) => void openFight(index)} />}
      {bothKinds && <h2 className="cap section-label">{t('pulls.raidBosses')}</h2>}
      {groups.length > 0 ? (
        <PullList groups={groups} onOpen={(index) => void openFight(index)} />
      ) : (
        runs.length === 0 && <EmptyState title={t('pulls.noneTitle')} text={t('pulls.none')} />
      )}
    </>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <section className="panel panel-pad empty-state" aria-label={title}>
      <div className="cap">{title}</div>
      <p>{text}</p>
    </section>
  );
}
