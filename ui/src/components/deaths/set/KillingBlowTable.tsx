import { useId } from 'react';
import type { SetDeaths } from '../../../api/types';
import { formatInteger } from '../../../i18n/format';
import { t } from '../../../i18n/i18n';
import { GameIcon, MonogramTile } from '../../GameIcon';
import { barWidth, hitIcon, hitName, reportSpellName } from '../../reports/reportData';

/** The killing blows of the listed deaths by spell name, with the sources that landed them most. */
export function KillingBlowTable({ report }: { report: SetDeaths }) {
  const titleId = useId();
  const rows = report.byKillingBlow;
  const top = Math.max(1, ...rows.map((row) => row.count));
  const spellName = (id: number) => reportSpellName(report.spells, id);
  return (
    <section className="panel panel-clip" aria-labelledby={titleId}>
      <div className="panel-head panel-head-list">
        <h2 className="h2" id={titleId}>
          {t('setDeaths.byBlow')}
        </h2>
        <span className="num panel-hint">{t('setDeaths.abilities', { count: rows.length })}</span>
      </div>
      {rows.length === 0 && report.noLethal === 0 ? (
        <p className="muted pad">{t('deaths.noneInSet')}</p>
      ) : (
        <div className="scroll-box">
          <table className="ctable rtable sd-table" aria-labelledby={titleId}>
            <colgroup>
              <col />
              <col className="sd-col-bar" />
              <col className="sd-col-num" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="cap">
                  {t('deaths.column.killingBlow')}
                </th>
                <th scope="col">
                  <span className="sr-only">{t('setDeaths.column.share')}</span>
                </th>
                <th scope="col" className="cap r">
                  {t('setDeaths.column.deaths')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const name = hitName(row, spellName);
                return (
                  <tr key={`${row.spellId}-${row.environmental}`}>
                    <th scope="row">
                      <span className="sd-name">
                        <GameIcon name={name} icon={hitIcon(row)} size={22} />
                        <span className="sd-name-text">{name}</span>
                        <span className="sd-sub">{row.sources.join(', ')}</span>
                      </span>
                    </th>
                    <td>
                      <span className="bar" aria-hidden="true">
                        <span className="bar-fill-death" style={{ width: barWidth((row.count / top) * 100) }} />
                      </span>
                    </td>
                    <td className="r num">{formatInteger(row.count)}</td>
                  </tr>
                );
              })}
              {report.noLethal > 0 && (
                <tr className="sd-row-muted">
                  <th scope="row">
                    <span className="sd-name">
                      <MonogramTile name="?" size={22} />
                      <span className="sd-name-text">{t('setDeaths.noLethal')}</span>
                    </span>
                  </th>
                  <td className="sd-sub">{t('setDeaths.noLethalNote')}</td>
                  <td className="r num">{formatInteger(report.noLethal)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
