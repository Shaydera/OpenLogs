import type { ReactNode } from 'react';
import type { InterruptsReport, PlayerRef } from '../../api/types';
import { spellIconUrl } from '../../icons';
import { formatEventTime, formatInteger } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { GameIcon } from '../GameIcon';
import { classColor, shortName } from '../overview/players';
import { PlayerIcon } from '../reports/PlayerName';
import { reportSpellName, rosterIndex } from '../reports/reportData';
import { kickPlayers } from './kickModel';

/** The tab's key figures sit in the fight header. */
export function InterruptsTab({ report }: { report: InterruptsReport }) {
  const roster = rosterIndex(report.roster);
  const spell = (id: number) => reportSpellName(report.spells, id);
  const nameOf = (id: number) => shortName(roster.get(id)?.name ?? '');
  const players = kickPlayers(report, nameOf);
  const maxKicks = Math.max(1, ...players.map((p) => p.interrupts));

  const playerCell = (id: number) => {
    const ref = roster.get(id);
    return (
      <span role="cell" className="kick-cell">
        <PlayerIcon player={ref} size={18} />
        <span className="kick-player" style={{ color: classColor(ref?.classToken ?? null) }}>
          {ref ? shortName(ref.name) : t('report.unknownPlayer')}
        </span>
      </span>
    );
  };
  const unitCell = (name: string | null) => (
    <span role="cell" className="kick-cell">
      <span className="kick-text kick-text-muted">{name ?? t('kicks.unknownUnit')}</span>
    </span>
  );
  const spellCell = (id: number, extra: ReactNode = null, warn = false) => (
    <span role="cell" className="kick-cell">
      <GameIcon name={spell(id)} src={spellIconUrl(id)} size={18} />
      <span className={warn ? 'kick-text kick-text-warn' : 'kick-text'}>{spell(id)}</span>
      {extra}
    </span>
  );

  return (
    <div className="kicks-page">
      <div className="kicks-layout">
        <section className="panel panel-clip kicks-players" aria-labelledby="kicks-players-title">
          <div className="panel-head panel-head-list">
            <h2 id="kicks-players-title" className="h2">
              {t('kicks.byPlayer')}
            </h2>
            <span className="kicks-summary">
              <span className="num value-text">{formatInteger(report.interrupts.length)}</span>{' '}
              {t('kicks.interruptWord', { count: report.interrupts.length })} ·{' '}
              <span className="num value-text">{formatInteger(report.dispels.length)}</span>{' '}
              {t('kicks.dispelWord', { count: report.dispels.length })}
            </span>
          </div>
          {players.length === 0 ? (
            <p className="muted pad">{t('kicks.noneByPlayer')}</p>
          ) : (
            <div className="scroll-x">
              <div className="kick-prows" role="table" aria-label={t('kicks.byPlayer')}>
                <div role="row" className="kick-prow kick-prow-head">
                  <span role="columnheader">
                    <span className="sr-only">{t('recap.iconColumn')}</span>
                  </span>
                  <span role="columnheader" className="cap kick-cap">
                    {t('report.player')}
                  </span>
                  <span role="columnheader" className="cap kick-cap">
                    {t('casts.role')}
                  </span>
                  <span role="columnheader" className="cap kick-cap">
                    {t('kicks.interrupts')}
                  </span>
                  <span role="columnheader" className="cap kick-cap kick-cap-end">
                    {t('kicks.dispels')}
                  </span>
                </div>
                {players.map((p) => (
                  <KickPlayerRow key={p.player} player={roster.get(p.player)} interrupts={p.interrupts} dispels={p.dispels} maxKicks={maxKicks} />
                ))}
              </div>
            </div>
          )}
        </section>
        <div className="kicks-logs">
          {report.missed.length > 0 && (
            <section className="panel panel-clip" aria-labelledby="kicks-missed-title">
              <div className="panel-head panel-head-tight">
                <div>
                  <h2 id="kicks-missed-title" className="h2">
                    {t('kicks.missed')} <span className="num h2-count">{formatInteger(report.missed.length)}</span>
                  </h2>
                  <div className="panel-sub">{t('kicks.missedHint')}</div>
                </div>
              </div>
              <div className="scroll-x">
                <div className="kick-log scroll-box" role="table" aria-label={t('kicks.missed')} tabIndex={0}>
                  <div role="row" className="kick-ev kick-ev-three kick-ev-head">
                    {[t('ability.time'), t('kicks.caster'), t('casts.spell')].map((h) => (
                      <span key={h} role="columnheader" className="cap kick-cap">
                        {h}
                      </span>
                    ))}
                  </div>
                  {report.missed.map((m, i) => (
                    <div key={`${m.t}-${i}`} role="row" className="kick-ev kick-ev-three kick-ev-warn">
                      <span role="cell" className="num kick-time">
                        {formatEventTime(m.t)}
                      </span>
                      {unitCell(m.sourceName)}
                      {spellCell(m.spellId, null, true)}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
          <KickLog
            id="kicks-interrupts-title"
            title={t('kicks.interrupts')}
            count={report.interrupts.length}
            empty={t('kicks.noInterrupts')}
            head={[t('ability.time'), t('report.player'), t('casts.spell'), t('ability.target'), t('kicks.interrupted')]}
          >
            {report.interrupts.map((k, i) => (
              <div key={`${k.t}-${i}`} role="row" className="kick-ev">
                <span role="cell" className="num kick-time">
                  {formatEventTime(k.t)}
                </span>
                {playerCell(k.player)}
                {spellCell(k.spellId)}
                {unitCell(k.targetName)}
                {spellCell(k.interruptedId)}
              </div>
            ))}
          </KickLog>
          <KickLog
            id="kicks-dispels-title"
            title={t('kicks.dispels')}
            count={report.dispels.length}
            empty={t('kicks.noDispels')}
            head={[t('ability.time'), t('report.player'), t('casts.spell'), t('ability.target'), t('kicks.removed')]}
          >
            {report.dispels.map((d, i) => (
              <div key={`${d.t}-${i}`} role="row" className="kick-ev">
                <span role="cell" className="num kick-time">
                  {formatEventTime(d.t)}
                </span>
                {playerCell(d.player)}
                {spellCell(d.spellId)}
                {d.target !== null ? playerCell(d.target) : unitCell(d.targetName)}
                {spellCell(d.removedId, d.stolen ? <span className="rtag">{t('kicks.stolen')}</span> : null)}
              </div>
            ))}
          </KickLog>
        </div>
      </div>
    </div>
  );
}

function KickPlayerRow({ player, interrupts, dispels, maxKicks }: { player: PlayerRef | undefined; interrupts: number; dispels: number; maxKicks: number }) {
  const colour = classColor(player?.classToken ?? null);
  return (
    <div role="row" className="kick-prow">
      <span role="cell">
        <PlayerIcon player={player} size={22} />
      </span>
      <span role="cell" className="kick-name" style={{ color: colour }} title={player ? shortName(player.name) : undefined}>
        {player ? shortName(player.name) : t('report.unknownPlayer')}
      </span>
      <span role="cell">{player?.role ? <span className="role-pill">{t(`role.short.${player.role}`)}</span> : null}</span>
      <span role="cell" className="kick-bar">
        <span className="bar bar-lg" aria-hidden="true">
          <span style={{ width: `${(interrupts / maxKicks) * 100}%`, background: colour }} />
        </span>
        <span className={interrupts > 0 ? 'num kick-count' : 'num kick-count dash'}>{interrupts > 0 ? formatInteger(interrupts) : '—'}</span>
      </span>
      <span role="cell" className={dispels > 0 ? 'num kick-end' : 'num kick-end dash'}>
        {dispels > 0 ? formatInteger(dispels) : '—'}
      </span>
    </div>
  );
}

function KickLog({ id, title, count, empty, head, children }: { id: string; title: string; count: number; empty: string; head: string[]; children: ReactNode }) {
  return (
    <section className="panel panel-clip" aria-labelledby={id}>
      <div className="panel-head panel-head-tight">
        <h2 id={id} className="h2">
          {title} <span className="num h2-count">{formatInteger(count)}</span>
        </h2>
      </div>
      {count === 0 ? (
        <p className="muted pad">{empty}</p>
      ) : (
        <div className="scroll-x">
          <div className="kick-log scroll-box" role="table" aria-label={title} tabIndex={0}>
            <div role="row" className="kick-ev kick-ev-head">
              {head.map((h) => (
                <span key={h} role="columnheader" className="cap kick-cap">
                  {h}
                </span>
              ))}
            </div>
            {children}
          </div>
        </div>
      )}
    </section>
  );
}
