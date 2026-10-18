import { useRef } from 'react';
import type { QuickOverview } from '../api/types';
import { useFocusRequest } from '../hooks/useFocusRequest';
import { t } from '../i18n/i18n';
import { rangeKey } from '../pulls/groupPulls';
import { replaySplitShown, useApp } from '../store';
import { AbilityDetailView } from './ability/AbilityDetailView';
import { AurasTab } from './auras/AurasTab';
import { CastsTab } from './casts/CastsTab';
import { FightHeader } from './chrome/FightHeader';
import { headerTiles } from './chrome/headerTiles';
import { FightTopBar } from './chrome/FightTopBar';
import { PANEL_ID, TabBar, tabId } from './chrome/TabBar';
import { PullComparisonView } from './compare/PullComparisonView';
import { DeathsTab } from './deaths/DeathsTab';
import { ErrorBoundary } from './ErrorBoundary';
import { ViewLens } from './filters/ViewLens';
import { InterruptsTab } from './interrupts/InterruptsTab';
import { ConsumablesPanel } from './overview/ConsumablesPanel';
import { CooldownsPanel } from './overview/CooldownsPanel';
import { DeathsPanel } from './overview/DeathsPanel';
import { Timeline } from './overview/Timeline';
import { PlayerDetailView } from './player/PlayerDetailView';
import { DamageDoneTab } from './reports/DamageDoneTab';
import { DamageTakenTab } from './reports/DamageTakenTab';
import { HealingTab } from './reports/HealingTab';
import { RangePanel } from './reports/RangePanel';
import { ReplaySplit } from './replay/ReplaySplit';
import { ReplayTab } from './replay/ReplayTab';
import { ResourcesTab } from './resources/ResourcesTab';
import { TargetDetailView } from './target/TargetDetailView';
import { EventsView } from './views/EventsView';
import { TimelineView } from './views/TimelineView';
import { effectiveView } from '../reportViews';
import { isFilterTab } from '../scopeSides';

/** A fight screen: the top bar, then the pull header (compact on detail pages), the tab row and the tab's panel. */
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
  const rangeKpis = useApp((s) => s.rangeKpis);
  const details = useApp((s) => s.details);
  const closeDetail = useApp((s) => s.closeDetail);
  const comparing = useApp((s) => s.comparison !== null);
  const breakdown = useApp((s) => s.breakdown);
  const scope = useApp((s) => s.scope);
  const splitOn = useApp(replaySplitShown);
  const rangeOpen = useApp((s) => s.replay.rangeOpen);
  const setReplayRangeOpen = useApp((s) => s.setReplayRangeOpen);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const crumbRef = useRef<HTMLSpanElement>(null);
  // The pull title; on detail pages (compact header) the current breadcrumb.
  useFocusRequest('fight', () => titleRef.current ?? crumbRef.current);
  const row = view.kind === 'fight' ? log?.fights.find((f) => f.index === view.fightIndex) : undefined;
  if (!row) return null;
  // The comparison replaces the tabs; tab, range and details wait in the store for "Back".
  if (comparing)
    return (
      <div className="fight-view">
        <FightTopBar row={row} currentRef={crumbRef} />
        <PullComparisonView row={row} />
      </div>
    );

  const onOverview = tab === 'overview';
  const onReplay = tab === 'replay';
  const tiles =
    details.length > 0 ? null : headerTiles({ tab, row, overview, range, report, reportLoading, reportFailed, rangeKpis, breakdown, scope });

  const body = failed ? (
    <p className="muted">{t('fight.loadFailed')}</p>
  ) : loading || !overview ? (
    <p className="muted">{t('fight.loading')}</p>
  ) : onOverview ? (
    <>
      {/* The timeline is the Overview's brush and always shows the whole pull. */}
      <Timeline overview={overview} run={row.run !== null} />
      <RangeOverview whole={overview} />
    </>
  ) : (
    <>
      {/* Detail pages have no range panel. */}
      {details.length === 0 &&
        (onReplay ? (
          <div className="fight-column">
            <RangePanel overview={overview} rangeKey={rangeKey(row)} run={row.run !== null} collapsible={{ open: rangeOpen, onToggle: setReplayRangeOpen }} />
          </div>
        ) : (
          <RangePanel overview={overview} rangeKey={rangeKey(row)} run={row.run !== null} />
        ))}
      <ErrorBoundary key={`${tab}-${details.length}`} onReset={() => void closeDetail()}>
        {onReplay ? <ReplayTab /> : <ReportView />}
      </ErrorBoundary>
    </>
  );
  const alongside = splitOn && !onReplay && !failed && !loading && overview !== null;
  const page = ['fight-page', onOverview && 'fight-page-overview', onReplay && 'fight-page-full', alongside && 'fight-page-wide'].filter(Boolean).join(' ');

  return (
    <div className={onReplay ? 'fight-view fight-view-full' : 'fight-view'}>
      <FightTopBar row={row} currentRef={crumbRef} />
      <main className={page}>
        <div className="fight-column">
          <FightHeader row={row} tiles={tiles} titleRef={titleRef} />
          <ViewLens />
          <TabBar />
        </div>
        <div role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(tab)} className="tabpanel">
          {/* Outside the tab-keyed error boundary: the replay pane keeps its state while the report changes tabs. */}
          {alongside ? <ReplaySplit>{body}</ReplaySplit> : body}
        </div>
      </main>
    </div>
  );
}

function ReportView() {
  const report = useApp((s) => s.report);
  const loading = useApp((s) => s.reportLoading);
  const error = useApp((s) => s.reportError);
  const details = useApp((s) => s.details);
  const back = useApp((s) => s.back);
  const breakdown = useApp((s) => s.breakdown);
  const tab = useApp((s) => s.tab);
  const view = useApp((s) => effectiveView(s.tab, s.details.length > 0, s.reportView));
  if (view === 'events' && isFilterTab(tab)) return <EventsView key={tab} tab={tab} />;
  if (view === 'timeline' && isFilterTab(tab)) return <TimelineView key={tab} tab={tab} />;
  if (error)
    return (
      <div className="report-error">
        <p className="muted">{t('report.failed', { reason: error })}</p>
        {details.length > 0 && (
          <button type="button" className="btn" onClick={() => void back()}>
            {t('detail.back')}
          </button>
        )}
      </div>
    );
  if (!report) return <p className="muted">{loading ? t('report.loading') : ''}</p>;
  switch (report.tab) {
    case 'damage':
      return breakdown ? <DamageDoneTab report={report.data} breakdown={breakdown} /> : <p className="muted">{t('report.loading')}</p>;
    case 'healing':
      return breakdown ? <HealingTab report={report.data} breakdown={breakdown} /> : <p className="muted">{t('report.loading')}</p>;
    case 'taken':
      return breakdown ? <DamageTakenTab breakdown={breakdown} /> : <p className="muted">{t('report.loading')}</p>;
    case 'buffs':
      return <AurasTab report={report.data} />;
    case 'interrupts':
      return <InterruptsTab report={report.data} />;
    case 'resources':
      return <ResourcesTab report={report.data} />;
    case 'deaths':
      return <DeathsTab report={report.data} />;
    case 'casts':
      return <CastsTab report={report.data} />;
    case 'player':
      return <PlayerDetailView detail={report.data} />;
    case 'ability':
      return <AbilityDetailView detail={report.data} />;
    case 'target':
      return <TargetDetailView detail={report.data} />;
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
