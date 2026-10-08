import { useRef } from 'react';
import type { QuickOverview } from '../api/types';
import { useFocusRequest } from '../hooks/useFocusRequest';
import { t } from '../i18n/i18n';
import { useApp } from '../store';
import { FightHeader } from './chrome/FightHeader';
import { headerTiles } from './chrome/headerTiles';
import { FightTopBar } from './chrome/FightTopBar';
import { PANEL_ID, TabBar, tabId } from './chrome/TabBar';
import { ConsumablesPanel } from './overview/ConsumablesPanel';
import { CooldownsPanel } from './overview/CooldownsPanel';
import { DeathsPanel } from './overview/DeathsPanel';
import { Timeline } from './overview/Timeline';
import { DamageDoneTab } from './reports/DamageDoneTab';
import { DamageTakenTab } from './reports/DamageTakenTab';
import { HealingTab } from './reports/HealingTab';
import { RangePanel } from './reports/RangePanel';

/** A fight screen: the top bar, then the pull header, the tab row and the tab's panel. */
export function FightView() {
  const view = useApp((s) => s.view);
  const log = useApp((s) => s.log);
  const overview = useApp((s) => s.overview);
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

  const onOverview = tab === 'overview';
  const tiles = headerTiles({ tab, overview, range, report, reportLoading, reportFailed });

  return (
    <div className="fight-view">
      <FightTopBar row={row} />
      <main className={onOverview ? 'fight-page fight-page-overview' : 'fight-page'}>
        <FightHeader row={row} tiles={tiles} titleRef={titleRef} />
        <TabBar />
        <div role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(tab)} className="tabpanel">
          {failed ? (
            <p className="muted">{t('fight.loadFailed')}</p>
          ) : loading || !overview ? (
            <p className="muted">{t('fight.loading')}</p>
          ) : onOverview ? (
            <>
              {/* The timeline is the Overview's brush and always shows the whole pull. */}
              <Timeline overview={overview} />
              <RangeOverview whole={overview} />
            </>
          ) : (
            <>
              <RangePanel overview={overview} rangeKey={`${row.encounterId}:${row.difficulty}`} />
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
    case 'overview':
      // The Overview tab renders `RangeOverview`, never this view.
      return null;
  }
}

/** The Overview body for the whole pull, or for the range once it is calculated. */
function RangeOverview({ whole }: { whole: QuickOverview }) {
  const range = useApp((s) => s.range);
  const report = useApp((s) => s.report);
  const error = useApp((s) => s.reportError);
  if (range === null) return <OverviewPanels overview={whole} />;
  if (error) return <p className="muted">{t('report.failed', { reason: error })}</p>;
  if (report?.tab !== 'overview') return <p className="muted">{t('report.loading')}</p>;
  return <OverviewPanels overview={report.data} />;
}

/** The panels under the timeline; the key figures sit in the pull header. */
function OverviewPanels({ overview }: { overview: QuickOverview }) {
  return (
    <>
      <DeathsPanel overview={overview} />
      <ConsumablesPanel overview={overview} />
      <CooldownsPanel overview={overview} />
    </>
  );
}
