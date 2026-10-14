import { useMemo, type ReactNode } from 'react';
import type { DeathsReport, Kill } from '../../api/types';
import { formatDuration, formatEventTime } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { GameIcon, MonogramTile } from '../GameIcon';
import { valueLabel } from '../filters/labels';
import { NoMatch } from '../filters/NoMatch';
import { ReportHead } from '../filters/ReportHead';
import { classColor, playerIndex, shortName } from '../overview/players';
import { hitIcon, hitName, reportSpellName, rosterIndex } from '../reports/reportData';
import { DeathRecapView } from './DeathRecapView';
import { hitSource } from './recapModel';

/** Friendlies: the deaths with the selected one's recap; enemies: the kills. */
export function DeathsTab({ report }: { report: DeathsReport }) {
  const scope = useApp((s) => s.scope);
  return scope.perspective === 'enemy' ? <KillList report={report} /> : <DeathList report={report} />;
}

function DeathList({ report }: { report: DeathsReport }) {
  const focus = useApp((s) => s.focusDeath);
  const selectDeath = useApp((s) => s.selectDeath);
  const range = useApp((s) => s.range);
  const scope = useApp((s) => s.scope);
  const overview = useApp((s) => s.overview);
  const roster = useMemo(() => new Map([...(overview ? playerIndex(overview) : []), ...rosterIndex(report.roster)]), [overview, report.roster]);
  const one = scope.target.length === 1 ? scope.target[0] : null;
  const onePlayer = one?.kind === 'player' ? roster.get(one.actorId) : undefined;
  const title = onePlayer ? t('deaths.of', { name: shortName(onePlayer.name) }) : t('recap.all', { count: report.deaths.length });
  if (report.deaths.length === 0) {
    return (
      <section className="panel" aria-labelledby="deaths-empty-title">
        <ReportHead tab="deaths" id="deaths-empty-title" title={onePlayer ? title : t('tabs.deaths')} />
        <NoMatch nothing={t(range ? 'deaths.noneInRange' : 'deaths.none')} />
      </section>
    );
  }
  // Picked by (player, time): a range change keeps the death or falls back to the first.
  const index = Math.max(0, focus ? report.deaths.findIndex((d) => d.player === focus.player && d.t === focus.t) : 0);
  const spellName = (id: number) => reportSpellName(report.spells, id);
  // A selected killing-blow source or ability is the same for every death: the line leaves it out.
  const blowText = (kb: NonNullable<DeathsReport['deaths'][number]['killingBlow']>) =>
    [scope.ability.length === 0 && hitName(kb, spellName), scope.source.length === 0 && hitSource(kb)].filter(Boolean).join(' · ');
  return (
    <div className="deaths-page">
      <aside className="panel panel-clip deaths-list" aria-labelledby="deaths-list-title">
        <ReportHead tab="deaths" id="deaths-list-title" title={title} />
        <div role="group" aria-label={title}>
          {report.deaths.map((death, i) => {
            const name = shortName(death.playerName);
            const kb = death.killingBlow;
            const blow = kb ? hitName(kb, spellName) : '';
            return (
              <button
                key={`${death.player}-${death.t}`}
                type="button"
                className={i === index ? 'dlink dlink-on' : 'dlink'}
                aria-pressed={i === index}
                onClick={() => selectDeath(death.player, death.t)}
              >
                <span className="num dlink-time">{formatEventTime(death.t)}</span>
                {kb ? <GameIcon name={blow} icon={hitIcon(kb)} size={22} /> : <MonogramTile name={name} size={22} />}
                <span className="dlink-text">
                  {!onePlayer && (
                    <span className="dlink-name" style={{ color: classColor(roster.get(death.player)?.classToken ?? null) }} title={name}>
                      {name}
                    </span>
                  )}
                  <span className="dlink-blow">{kb ? blowText(kb) : t('deaths.noLethalHit')}</span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>
      <div className="deaths-main">
        <DeathRecapView recap={report.deaths[index]} report={report} />
      </div>
    </div>
  );
}

/** Enemy deaths: unit, time, the killing blow and its source, time alive. */
function KillList({ report }: { report: DeathsReport }) {
  const scope = useApp((s) => s.scope);
  const range = useApp((s) => s.range);
  const roster = rosterIndex(report.roster);
  const spellName = (id: number) => reportSpellName(report.spells, id);
  const pinnedUnit = scope.target.length === 1 && scope.target[0].kind === 'instance';
  const title = t('kills.title', { count: report.kills.length });
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
  return (
    <section className="panel panel-clip" aria-labelledby="kills-title">
      <ReportHead tab="deaths" id="kills-title" title={title} />
      {report.kills.length === 0 ? (
        <NoMatch nothing={t(range ? 'kills.noneInRange' : 'kills.none')} />
      ) : (
        <div className="scroll-x">
          <div className="kick-log" role="table" aria-label={title}>
            <div role="row" className="kick-ev kick-ev-head" style={grid}>
              {[t('ability.time'), ...columns.map((c) => c.head)].map((h) => (
                <span key={h} role="columnheader" className="cap kick-cap">
                  {h}
                </span>
              ))}
            </div>
            {report.kills.map((kill, i) => (
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
      )}
    </section>
  );
}
