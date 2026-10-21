import type { ReactNode } from 'react';
import { type DeathsReport, type Kill, type SetDeaths, isSetReport } from '../../api/types';
import { formatDuration, formatEventTime } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import type { PullView } from '../../pulls/groupPulls';
import { useApp } from '../../store';
import { GameIcon } from '../GameIcon';
import { valueLabel } from '../filters/labels';
import { NoMatch } from '../filters/NoMatch';
import { ReportHead } from '../filters/ReportHead';
import { classColor } from '../overview/players';
import { hitIcon, hitName, reportSpellName, rosterIndex } from '../reports/reportData';
import { PullHead } from '../set/PullHead';
import { DeathList } from './DeathList';
import { SetDeathsPage, usePullParts } from './set/SetDeathsPage';

/** Friendlies: the deaths with the selected one's recap (a set's with its overview panels); enemies: the kills. */
export function DeathsTab({ report }: { report: DeathsReport | SetDeaths }) {
  const enemies = useApp((s) => s.scope.perspective === 'enemy');
  if (isSetReport(report)) return enemies ? <SetKillList report={report} /> : <SetDeathsPage report={report} />;
  return enemies ? (
    <KillList report={report} groups={[{ fight: null, pull: null, kills: report.kills }]} />
  ) : (
    <DeathList report={report} groups={[{ fight: null, pull: null, deaths: report.deaths }]} />
  );
}

interface KillGroup {
  fight: number | null;
  pull: PullView | null;
  kills: Kill[];
}

function SetKillList({ report }: { report: SetDeaths }) {
  const parts = usePullParts(report);
  return <KillList report={report} groups={parts.map(({ part, pull }) => ({ fight: part.fightIndex, pull, kills: part.kills }))} />;
}

/** Enemy deaths: unit, time, the killing blow and its source, time alive; a set's under each pull's heading. */
function KillList({ report, groups }: { report: DeathsReport; groups: KillGroup[] }) {
  const scope = useApp((s) => s.scope);
  const range = useApp((s) => s.range);
  const roster = rosterIndex(report.roster);
  const spellName = (id: number) => reportSpellName(report.spells, id);
  const pinnedUnit = scope.target.length === 1 && scope.target[0].kind === 'instance';
  const inSet = groups.some((group) => group.pull !== null);
  const count = groups.reduce((sum, group) => sum + group.kills.length, 0);
  const title = t('kills.title', { count });
  const columns: { head: string; cell: (kill: Kill) => ReactNode }[] = [
    ...(!pinnedUnit ? [{ head: t('kills.unit'), cell: (k: Kill) => <span className="kick-text">{valueLabel(k.unit.unit, k.unit.name, k.unit.number)}</span> }] : []),
    ...(scope.ability.length === 0
      ? [
          {
            head: t('kills.blow'),
            cell: (k: Kill) =>
              k.killingBlow ? (
                <>
                  <GameIcon name={hitName(k.killingBlow, spellName)} icon={hitIcon(k.killingBlow)} size={18} />
                  <span className="kick-text">{hitName(k.killingBlow, spellName)}</span>
                </>
              ) : (
                <span className="kick-text kick-text-muted">{t('deaths.noLethalHit')}</span>
              ),
          },
        ]
      : []),
    ...(scope.source.length === 0
      ? [
          {
            head: t('kills.by'),
            cell: (k: Kill) => {
              const killer = k.killer;
              if (!killer) return <span className="kick-text kick-text-muted">—</span>;
              const player = killer.unit.kind === 'player' ? roster.get(killer.unit.actorId) : undefined;
              return (
                <span className={player ? 'kick-player' : 'kick-text'} style={player ? { color: classColor(player.classToken) } : undefined}>
                  {killer.unit.kind === 'environment' ? t('deaths.environment') : valueLabel(killer.unit, killer.name, killer.number)}
                </span>
              );
            },
          },
        ]
      : []),
    { head: t('kills.alive'), cell: (k: Kill) => <span className="num kick-text">{k.aliveMs !== null ? formatDuration(k.aliveMs) : '—'}</span> },
  ];
  const grid = { gridTemplateColumns: `64px repeat(${columns.length}, minmax(150px, 1fr))` };
  const table = (kills: Kill[], label: string) => (
    <div className="scroll-x">
      <div className="kick-log" role="table" aria-label={label}>
        <div role="row" className="kick-ev kick-ev-head" style={grid}>
          {[t('ability.time'), ...columns.map((c) => c.head)].map((h) => (
            <span key={h} role="columnheader" className="cap kick-cap">
              {h}
            </span>
          ))}
        </div>
        {kills.map((kill, i) => (
          <div key={`${kill.t}-${i}`} role="row" className="kick-ev" style={grid}>
            <span role="cell" className="num kick-time">
              {formatEventTime(kill.t)}
            </span>
            {columns.map((column) => (
              <span key={column.head} role="cell" className="kick-cell">
                {column.cell(kill)}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <section className="panel panel-clip" aria-labelledby="kills-title">
      <ReportHead tab="deaths" id="kills-title" title={title} />
      {count === 0 ? (
        <NoMatch nothing={t(inSet ? 'kills.noneInSet' : range ? 'kills.noneInRange' : 'kills.none')} />
      ) : inSet ? (
        groups.map(
          (group) =>
            group.pull &&
            group.kills.length > 0 && (
              <div key={group.fight} className="kill-group">
                <div className="pull-group-head">
                  <PullHead pull={group.pull} count={t('kills.count', { count: group.kills.length })} />
                </div>
                {table(group.kills, t('set.pull', { n: group.pull.n }))}
              </div>
            ),
        )
      ) : (
        table(groups[0]?.kills ?? [], title)
      )}
    </section>
  );
}
