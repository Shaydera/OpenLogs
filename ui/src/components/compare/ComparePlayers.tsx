import type { ReactNode } from 'react';
import type { ComparedPlayer, PlayerSide } from '../../api/types';
import { formatAmount, formatInteger, formatSignedAmount } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { PlayerName } from '../reports/PlayerName';

const dash = <span className="dash">—</span>;

/** A figure of one pull, or a dash when the player was not in it. */
function cell(side: PlayerSide | null, value: (side: PlayerSide) => string): ReactNode {
  return side === null ? dash : value(side);
}

/** DPS of both pulls and their difference, HPS for healers and deaths per pull, in the backend's order. */
export function ComparePlayers({ players, nA, nB }: { players: ComparedPlayer[]; nA: number; nB: number }) {
  return (
    <section className="panel" aria-labelledby="cmp-players-title">
      <div className="panel-head">
        <h2 id="cmp-players-title" className="h2">
          {t('compare.players')}
        </h2>
      </div>
      <p className="muted pad">{t('compare.playersNote', { a: nA, b: nB })}</p>
      <table className="ctable rtable" aria-labelledby="cmp-players-title">
        <thead>
          <tr>
            <th scope="col" className="cap">{t('report.player')}</th>
            <th scope="col" className="cap r">{t('compare.dpsOf', { n: nA })}</th>
            <th scope="col" className="cap r">{t('compare.dpsOf', { n: nB })}</th>
            <th scope="col" className="cap r">{t('compare.dpsDelta')}</th>
            <th scope="col" className="cap r">{t('compare.hpsOf', { n: nA })}</th>
            <th scope="col" className="cap r">{t('compare.hpsOf', { n: nB })}</th>
            <th scope="col" className="cap r">{t('compare.deathsOf', { n: nA })}</th>
            <th scope="col" className="cap r">{t('compare.deathsOf', { n: nB })}</th>
          </tr>
        </thead>
        <tbody>
          {players.map((row) => {
            // HPS where the player healed in that pull, or is a healer (a druid may switch roles).
            const healer = row.player.role === 'healer';
            const hps = (side: typeof row.a) => (side && (healer || side.hps > 0) ? formatAmount(side.hps) : dash);
            return (
              <tr key={`${row.player.name}-${row.a?.actorId}-${row.b?.actorId}`}>
                <th scope="row">
                  <PlayerName player={row.player} />
                </th>
                <td className="r num">{cell(row.a, (side) => formatAmount(side.dps))}</td>
                <td className="r num">{cell(row.b, (side) => formatAmount(side.dps))}</td>
                <td className="r num">{row.dpsDelta === null ? dash : formatSignedAmount(row.dpsDelta)}</td>
                <td className="r num">{hps(row.a)}</td>
                <td className="r num">{hps(row.b)}</td>
                <td className="r num">{cell(row.a, (side) => formatInteger(side.deaths))}</td>
                <td className="r num">{cell(row.b, (side) => formatInteger(side.deaths))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
