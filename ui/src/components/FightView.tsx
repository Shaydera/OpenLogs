import { useRef } from 'react';
import { useFocusRequest } from '../hooks/useFocusRequest';
import { t } from '../i18n/i18n';
import { useApp } from '../store';
import { FightHeader } from './chrome/FightHeader';
import { headerTiles } from './chrome/headerTiles';
import { FightTopBar } from './chrome/FightTopBar';
import { PANEL_ID, TabBar, tabId } from './chrome/TabBar';
import { DamageDoneTab } from './reports/DamageDoneTab';
import { DamageTakenTab } from './reports/DamageTakenTab';
import { HealingTab } from './reports/HealingTab';
import { RangePanel } from './reports/RangePanel';

/** A fight screen: the top bar, then the pull header, the tab row and the tab's panel. */
export function FightView() {
  const view = useApp((s) => s.view);
  const log = useApp((s) => s.log);
  const timeline = useApp((s) => s.timeline);
  const loading = useApp((s) => s.fightLoading);
  const failed = useApp((s) => s.fightError) !== null;
  const tab = useApp((s) => s.tab);
  const range = useApp((s) => s.range);
  const report = useApp((s) => s.report);
  const reportLoading = useApp((s) => s.reportLoading);
  const reportFailed = useApp((s) => s.reportError) !== null;
  const titleRef = useRef<HTMLHeadingElement>(null);
  useFocusRequest('fight', () => titleRef.current);
  const row = view.kind === 'fight' ? log?.fights.find((f) => f.index === view.fightIndex) : undefined;
  if (!row) return null;

  const tiles = headerTiles({ tab, timeline, range, report, reportLoading, reportFailed });

  return (
    <div className="fight-view">
      <FightTopBar row={row} />
      <main className="fight-page">
        <FightHeader row={row} tiles={tiles} titleRef={titleRef} />
        <TabBar />
        <div role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(tab)} className="tabpanel">
          {failed ? (
            <p className="muted">{t('fight.loadFailed')}</p>
          ) : loading || !timeline ? (
            <p className="muted">{t('fight.loading')}</p>
          ) : (
            <>
              <RangePanel timeline={timeline} rangeKey={`${row.encounterId}:${row.difficulty}`} />
              <ReportView />
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function ReportView() {
  const report = useApp((s) => s.report);
  const loading = useApp((s) => s.reportLoading);
  const error = useApp((s) => s.reportError);
  if (error) return <p className="muted">{t('report.failed', { reason: error })}</p>;
  if (!report) return <p className="muted">{loading ? t('report.loading') : ''}</p>;
  switch (report.tab) {
    case 'damage':
      return <DamageDoneTab report={report.data} />;
    case 'healing':
      return <HealingTab report={report.data} />;
    case 'taken':
      return <DamageTakenTab report={report.data} />;
  }
}
