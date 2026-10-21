import { useId, useMemo, useState } from 'react';
import type { SetDeaths } from '../../../api/types';
import { formatEventTimeTenths, formatPercent, formatShare } from '../../../i18n/format';
import { t } from '../../../i18n/i18n';
import { PULL_CHIP } from '../../../pulls/groupPulls';
import { shortName } from '../../overview/players';
import { PlayerName } from '../../reports/PlayerName';
import { rosterIndex } from '../../reports/reportData';
import { LIFE_BANDS, type LifetimeCell, lifeBand, lifetimeRows, minPullOptions } from './lifetimeModel';
import type { PullPart } from './SetDeathsPage';

function Cell({ cell }: { cell: LifetimeCell | null }) {
  if (!cell) {
    return (
      <td className="r num sd-life-none" title={t('setDeaths.notInPull')}>
        –
      </td>
    );
  }
  const band = lifeBand(cell.pct);
  const title = cell.firstDeathMs === null ? t('setDeaths.survived') : t('setDeaths.firstDeathAt', { time: formatEventTimeTenths(cell.firstDeathMs) });
  return (
    <td className={band ? `r num life-b${band}` : 'r num sd-life-survived'} title={title}>
      {formatShare(cell.pct)}
    </td>
  );
}

/** Per player and pull, the share of the pull they stayed alive for, lowest average first. */
export function LifetimeMatrix({ parts, report }: { parts: PullPart[]; report: SetDeaths }) {
  const [minPulls, setMinPulls] = useState(1);
  const titleId = useId();
  const roster = useMemo(() => rosterIndex(report.roster), [report.roster]);
  const rows = useMemo(
    () => lifetimeRows(parts.map(({ part }) => part), (id) => shortName(roster.get(id)?.name ?? '')),
    [parts, roster],
  );
  const options = minPullOptions(parts.length);
  const shown = rows.filter((row) => row.pulls >= minPulls);
  return (
    <section className="panel panel-clip" aria-labelledby={titleId}>
      <div className="panel-head panel-head-list sd-life-head">
        <h2 className="h2" id={titleId}>
          {t('setDeaths.lifetime')}
        </h2>
        <span className="panel-hint">{t('setDeaths.lifetimeHint')}</span>
        <span className="sd-life-tools">
          {options.length > 1 && (
            <span className="seg-wrap">
              <span className="cap text-muted">{t('setDeaths.playersCaption')}</span>
              <span className="seg seg-sm" role="group" aria-label={t('setDeaths.playersShown')}>
                {options.map((min) => (
                  <button key={min} type="button" className={min === minPulls ? 'on' : undefined} aria-pressed={min === minPulls} onClick={() => setMinPulls(min)}>
                    {min === 1 ? t('setDeaths.allPlayers') : t('setDeaths.inPulls', { count: min })}
                  </button>
                ))}
              </span>
            </span>
          )}
          <ul className="sd-bands" aria-label={t('setDeaths.bands')}>
            {LIFE_BANDS.map((band) => (
              <li key={band} className={`sd-band life-b${band}`}>
                {t('setDeaths.band', { pct: formatPercent(band) })}
              </li>
            ))}
            <li className="sd-band sd-band-survived">{t('setDeaths.bandSurvived')}</li>
          </ul>
        </span>
      </div>
      <div className="sd-life-scroll">
        <table className="ctable rtable sd-life" aria-labelledby={titleId}>
          <thead>
            <tr>
              <th scope="col" className="cap sd-life-player">
                {t('report.player')}
              </th>
              <th scope="col" className="cap r" title={t('setDeaths.avgTitle')}>
                {t('setDeaths.avg')}
              </th>
              <th scope="col" className="cap r sd-life-sep" title={t('setDeaths.avgTimeTitle')}>
                {t('setDeaths.avgTime')}
              </th>
              {parts.map(({ part, pull }) => (
                <th key={part.fightIndex} scope="col" className={`cap r sd-pull-${PULL_CHIP[pull.status]}`}>
                  {t('setDeaths.pullColumn', { n: pull.n, status: t(`status.${pull.status}`) })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.player}>
                <th scope="row" className="sd-life-player">
                  <PlayerName player={roster.get(row.player)} />
                </th>
                <td className="r num sd-life-avg">{formatShare(row.avgPct)}</td>
                <td className="r num text-soft sd-life-sep">{formatShare(row.avgTimePct)}</td>
                {row.cells.map((cell, i) => (
                  <Cell key={parts[i].part.fightIndex} cell={cell} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
