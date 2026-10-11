import type { DeathEntry, PullComparison, QuickOverview } from '../../api/types';
import { formatEventTime } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { GameIcon } from '../GameIcon';
import { classColor, playerIndex, shortName, spellName } from '../overview/players';
import { hitIconUrl, hitName, sourceLabel } from '../reports/reportData';

/** Every death of both pulls in time order: time, player, killing blow. */
export function CompareDeaths({ data, labelA, labelB }: { data: PullComparison; labelA: string; labelB: string }) {
  return (
    <section className="panel" aria-labelledby="cmp-deaths-title">
      <div className="panel-head">
        <h2 id="cmp-deaths-title" className="h2">
          {t('compare.deaths')}
        </h2>
      </div>
      <div className="cmp-deaths">
        <DeathColumn label={labelA} overview={data.a.overview} />
        <DeathColumn label={labelB} overview={data.b.overview} />
      </div>
    </section>
  );
}

function DeathColumn({ label, overview }: { label: string; overview: QuickOverview }) {
  const players = playerIndex(overview);
  const title = t('compare.deathCount', { pull: label, count: overview.deaths.length });
  return (
    <section aria-label={title}>
      <h3 className="h3">{title}</h3>
      {overview.deaths.length === 0 ? (
        <p className="muted">{t('deaths.none')}</p>
      ) : (
        <ol className="plain">
          {overview.deaths.map((death) => (
            <DeathLine
              key={`${death.player}-${death.t}`}
              death={death}
              overview={overview}
              color={classColor(players.get(death.player)?.classToken ?? null)}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function DeathLine({ death, overview, color }: { death: DeathEntry; overview: QuickOverview; color: string }) {
  const kb = death.killingBlow;
  return (
    <li className="cmp-death">
      <span className="num">{formatEventTime(death.t)}</span>
      <span className="death-name" style={{ color }}>
        {shortName(death.playerName)}
      </span>
      {kb ? (
        <span className="spell-line">
          <GameIcon name={hitName(kb, (id) => spellName(overview, id))} src={hitIconUrl(kb)} size={18} />
          <span>{t('recap.killedBy', { spell: hitName(kb, (id) => spellName(overview, id)), source: sourceLabel(kb) })}</span>
        </span>
      ) : (
        <span className="muted">{t('deaths.noLethalHit')}</span>
      )}
    </li>
  );
}
