import { useMemo } from 'react';
import type { SetDeaths, SetDeathsPull } from '../../../api/types';
import type { PullView } from '../../../pulls/groupPulls';
import { useApp } from '../../../store';
import { useSetPullViews } from '../../set/useSetPullViews';
import { DeathList, pickDeath } from '../DeathList';
import { DeathWindowChart } from './DeathWindowChart';
import { KillingBlowTable } from './KillingBlowTable';
import { LifetimeMatrix } from './LifetimeMatrix';
import { PlayerDeathsTable } from './PlayerDeathsTable';

export interface PullPart {
  part: SetDeathsPull;
  pull: PullView;
}

/** The report's pulls in set order with their number and result. */
export function usePullParts(report: SetDeaths): PullPart[] {
  const views = useSetPullViews();
  return useMemo(
    () =>
      report.pulls.flatMap((part) => {
        const pull = views.get(part.fightIndex);
        return pull ? [{ part, pull }] : [];
      }),
    [views, report.pulls],
  );
}

/** A set's friendly deaths: the death windows, what killed whom, how long everyone lived, then the deaths with their recap. */
export function SetDeathsPage({ report }: { report: SetDeaths }) {
  const parts = usePullParts(report);
  const onePlayer = useApp((s) => s.scope.target.length === 1 && s.scope.target[0].kind === 'player');
  const focus = useApp((s) => s.focusDeath);
  const groups = useMemo(() => parts.map(({ part, pull }) => ({ fight: part.fightIndex, pull, deaths: part.deaths })), [parts]);
  const selected = pickDeath(groups, focus);
  return (
    <div className="set-deaths">
      <DeathWindowChart parts={parts} report={report} selected={selected?.death ?? null} />
      <div className="set-deaths-pair">
        <KillingBlowTable report={report} />
        {!onePlayer && <PlayerDeathsTable report={report} />}
      </div>
      <LifetimeMatrix parts={parts} report={report} />
      <DeathList report={report} groups={groups} />
    </div>
  );
}
