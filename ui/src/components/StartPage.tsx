import { useEffect, useMemo, useRef, useState } from 'react';
import { useFocusRequest } from '../hooks/useFocusRequest';
import { type ChosenLog, chooseLog as pickLog } from '../api/logSource';
import type { Game, LogView } from '../api/types';
import { formatBytes, formatDateTime, formatList } from '../i18n/format';
import { t } from '../i18n/i18n';
import { combatPulls, groupPulls, groupRuns } from '../pulls/groupPulls';
import { logStartMs } from '../pulls/logStart';
import { useApp } from '../store';
import { AppWordmark } from './AppLogo';
import { ThemeSwitch } from './chrome/ThemeSwitch';
import { DropZone } from './DropZone';
import { CombatPullList, PullList, RunCards } from './PullList';
import { RecentLogs } from './RecentLogs';

function gameName(game: Game | null): string {
  if (game === null) return t('game.unknown');
  return game.kind === 'other' ? t('game.other', { id: game.projectId }) : t(`game.${game.kind}`);
}

const SKIPPED_EVENTS_SHOWN = 3;

function skippedEvents(byEvent: Record<string, number>): string | null {
  const top = Object.entries(byEvent)
    .sort(([, a], [, b]) => b - a)
    .slice(0, SKIPPED_EVENTS_SHOWN)
    .map(([event, count]) => t('log.skippedEvent', { event, count }));
  return top.length > 0 ? t('log.skippedMostly', { events: formatList(top) }) : null;
}

export function StartPage({ dragOver }: { dragOver: boolean }) {
  const recent = useApp((s) => s.recent);
  const log = useApp((s) => s.log);
  const opening = useApp((s) => s.opening);
  const openLog = useApp((s) => s.openLog);
  const openRecent = useApp((s) => s.openRecent);
  const removeRecent = useApp((s) => s.removeRecent);
  const showError = useApp((s) => s.showError);
  const openSettings = useApp((s) => s.openSettings);
  // Chromium's picker refuses system folders such as Program Files, where WoW is installed by
  // default, and reports that like a cancelled dialog; a dropped file still opens.
  const [pickedNothing, setPickedNothing] = useState(false);
  useEffect(() => {
    if (opening) setPickedNothing(false);
  }, [opening]);
  const showFolderNotice = pickedNothing && !opening;

  async function chooseLog() {
    let chosen: ChosenLog | null;
    try {
      chosen = await pickLog();
    } catch (err) {
      showError(t('error.dialogFailed', { reason: String(err) }));
      return;
    }
    setPickedNothing(chosen === null);
    if (chosen) await openLog(chosen);
  }

  return (
    <div className="ui-scaled">
      <header className="topbar brand-island">
        <div className="brand-row">
          <AppWordmark size={32} />
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
          <DropZone over={dragOver || showFolderNotice} opening={opening} />
          <RecentLogs recent={recent} selectedId={log?.id ?? null} onOpen={(entry) => void openRecent(entry)} onRemove={(entry) => void removeRecent(entry)} />
        </aside>
        <main className="content">
          {showFolderNotice && <FolderNotice onDismiss={() => setPickedNothing(false)} />}
          {log ? <LogPulls log={log} /> : !showFolderNotice && <EmptyState title={t('start.emptyTitle')} text={t('start.empty')} />}
        </main>
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
  const openSet = useApp((s) => s.openSet);
  const groups = useMemo(() => groupPulls(log.fights, hideAborted), [log.fights, hideAborted]);
  const runs = useMemo(() => groupRuns(log.fights, hideAborted), [log.fights, hideAborted]);
  const combat = useMemo(() => combatPulls(log.fights, hideAborted), [log.fights, hideAborted]);
  const start = logStartMs(log.fileName, log.startUnixMs);
  const heading = [log.zone, start !== null ? formatDateTime(start) : null].filter(Boolean).join(' · ');
  const labelled = [runs, groups, combat].filter((section) => section.length > 0).length > 1;
  const open = (index: number) => void openFight(index);

  return (
    <>
      <div className="log-head">
        <div className="log-id">
          {heading && <div className="cap">{heading}</div>}
          <h1 ref={titleRef} tabIndex={-1} className="num log-title">{log.fileName}</h1>
          <div className="log-meta">
            {t('log.meta', {
              game: gameName(log.game),
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
          {log.brokenLines > 0 && (
            <p className="warning">{[t('log.skippedLines', { count: log.brokenLines }), skippedEvents(log.brokenByEvent)].filter(Boolean).join(' ')}</p>
          )}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={hideAborted} onChange={(event) => setHideAborted(event.target.checked)} />
          {t('pulls.hideAborted')}
        </label>
      </div>
      {labelled && runs.length > 0 && <h2 className="cap section-label">{t('runs.title')}</h2>}
      {runs.length > 0 && <RunCards runs={runs} onOpen={open} />}
      {labelled && groups.length > 0 && <h2 className="cap section-label">{t('pulls.raidBosses')}</h2>}
      {groups.length > 0 && <PullList groups={groups} onOpen={open} onOpenSet={(set) => void openSet(set)} />}
      {combat.length > 0 && (
        <>
          <h2 className="cap section-label">{t('combat.title')}</h2>
          <CombatPullList pulls={combat} onOpen={open} />
        </>
      )}
      {runs.length === 0 && groups.length === 0 && combat.length === 0 && <EmptyState title={t('pulls.noneTitle')} text={t('pulls.none')} />}
    </>
  );
}

function FolderNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <section className="panel panel-pad folder-notice" role="status" aria-label={t('start.folderNoticeTitle')}>
      <div className="cap">{t('start.folderNoticeTitle')}</div>
      <h2 className="folder-notice-headline">{t('start.folderNoticeHeadline')}</h2>
      <p>{t('start.folderNoticeText')}</p>
      <button type="button" className="btn" onClick={onDismiss}>
        {t('error.dismiss')}
      </button>
    </section>
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
