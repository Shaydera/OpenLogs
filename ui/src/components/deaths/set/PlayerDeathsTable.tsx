import { useId, useMemo } from 'react';
import type { SetDeaths } from '../../../api/types';
import { formatInteger } from '../../../i18n/format';
import { t } from '../../../i18n/i18n';
import { classColor } from '../../overview/players';
import { PlayerName } from '../../reports/PlayerName';
import { barWidth, rosterIndex } from '../../reports/reportData';

/** Every player of the set with the pulls they were in and their deaths, most deaths first. */
export function PlayerDeathsTable({ report }: { report: SetDeaths }) {
  const titleId = useId();
  const roster = useMemo(() => rosterIndex(report.roster), [report.roster]);
  const rows = report.byPlayer;
  const top = Math.max(1, ...rows.map((row) => row.deaths));
  return (
    <section className="panel panel-clip" aria-labelledby={titleId}>
      <div className="panel-head panel-head-list">
        <h2 className="h2" id={titleId}>
          {t('setDeaths.byPlayer')}
        </h2>
        <span className="num panel-hint">{t('setDeaths.players', { count: rows.length })}</span>
      </div>
      <div className="scroll-box">
        <table className="ctable rtable sd-table" aria-labelledby={titleId}>
          <colgroup>
            <col />
            <col className="sd-col-bar-sm" />
            <col className="sd-col-num" />
            <col className="sd-col-num" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="cap">
                {t('report.player')}
              </th>
              <th scope="col">
                <span className="sr-only">{t('setDeaths.column.share')}</span>
              </th>
              <th scope="col" className="cap r">
                {t('setDeaths.column.pulls')}
              </th>
              <th scope="col" className="cap r">
                {t('setDeaths.column.deaths')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const player = roster.get(row.player);
              return (
                <tr key={row.player}>
                  <th scope="row">
                    <span className="sd-name">
                      <PlayerName player={player} />
                      {player?.specName && <span className="sd-sub">{player.specName}</span>}
                    </span>
                  </th>
                  <td>
                    <span className="bar" aria-hidden="true">
                      <span style={{ width: barWidth((row.deaths / top) * 100), background: classColor(player?.classToken ?? null) }} />
                    </span>
                  </td>
                  <td className="r num text-muted">{formatInteger(row.pulls)}</td>
                  <td className="r num">{formatInteger(row.deaths)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
