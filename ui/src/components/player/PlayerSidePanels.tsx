import type { PlayerDeath, PlayerDetail, PlayerRef, SpellAmount } from '../../api/types';
import { spellIconUrl } from '../../icons';
import { formatCount, formatEventTime, formatList, formatMillions } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { GameIcon } from '../GameIcon';
import { classColor, shortName } from '../overview/players';
import { hitIconUrl, hitName, reportSpellName, rosterIndex, sourceLabel } from '../reports/reportData';
import { deathSummary } from './deathSummary';

/** Spell rows; `environmental` marks world damage, which shares spell 0 with melee. */
type SpellRow = SpellAmount & { environmental?: boolean };

/** Icon, name over a bar, the amount in millions. */
function SpellList({ rows, detail, label, empty, taken }: { rows: SpellRow[]; detail: PlayerDetail; label: string; empty: string; taken: boolean }) {
  if (rows.length === 0) return <p className="muted pad">{empty}</p>;
  const largest = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <div role="table" aria-label={label}>
      {rows.map((row) => {
        const hit = { spellId: row.spellId, environmental: row.environmental ?? false };
        const name = hitName(hit, (id) => reportSpellName(detail.spells, id));
        return (
          <div key={`${row.spellId}-${hit.environmental}`} className="lst-row" role="row">
            <span role="cell">
              <GameIcon name={name} src={hitIconUrl(hit)} size={18} />
            </span>
            <span role="cell" className="lst-name">
              <span>{name}</span>
              <span className="bar bar-sm" aria-hidden="true">
                <span className={taken ? 'lst-fill-taken' : 'bar-fill-support'} style={{ width: `${(row.amount / largest) * 100}%` }} />
              </span>
            </span>
            <span role="cell" className="num lst-amount">
              {formatMillions(row.amount)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function PlayerSidePanels({ detail }: { detail: PlayerDetail }) {
  const roster = rosterIndex(detail.roster);
  const healing = detail.metric === 'healing';
  // "Survived the range." only while a time range is set; the whole pull reads "Survived.".
  const range = useApp((s) => s.range);
  const evokers = detail.supportReceivedFrom.map((s) => shortName(roster.get(s.player)?.name ?? '?'));
  return (
    <div className="player-panels">
      <section className="panel pp-wide" id="p-aug" aria-labelledby="player-support-title">
        <div className="panel-head panel-head-tight">
          <div>
            <h2 id="player-support-title" tabIndex={-1} className="h2">
              {t('player.supportReceived')}
            </h2>
            {evokers.length > 0 && (
              <div className="panel-sub">{t(healing ? 'player.supportHintHealing' : 'player.supportHint', { names: formatList(evokers) })}</div>
            )}
          </div>
        </div>
        <SpellList rows={detail.supportBySpell} detail={detail} label={t('player.supportReceived')} empty={t('player.noSupport')} taken={false} />
      </section>
      <section className="panel pp-wide" id="p-taken" aria-labelledby="player-taken-title">
        <div className="panel-head panel-head-tight">
          <div>
            <h2 id="player-taken-title" tabIndex={-1} className="h2">
              {t('player.damageTaken')}
            </h2>
            <div className="panel-sub">{t('player.takenHint', { name: shortName(detail.player.name) })}</div>
          </div>
        </div>
        <SpellList rows={detail.takenBySpell} detail={detail} label={t('player.damageTaken')} empty={t('player.noTaken')} taken />
      </section>
      <section className="panel pp-narrow" aria-labelledby="player-deaths-title">
        <div className="panel-head panel-head-tight">
          <h2 id="player-deaths-title" className="h2">
            {t('player.deathsTitle', { count: detail.deaths.length })}
          </h2>
        </div>
        {detail.deaths.length === 0 ? (
          <p className="muted pad">
            {detail.deadSince !== null ? t('player.deadSinceLong', { time: formatEventTime(detail.deadSince) }) : t(range ? 'player.noDeathsInRange' : 'player.noDeaths')}
          </p>
        ) : (
          <div className="pdeath">
            {detail.deaths.map((death) => (
              <DeathBlock key={death.t} detail={detail} death={death} roster={roster} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DeathBlock({ detail, death, roster }: { detail: PlayerDetail; death: PlayerDeath; roster: Map<number, PlayerRef> }) {
  const spell = (id: number) => reportSpellName(detail.spells, id);
  const kb = death.killingBlow;
  const summary = deathSummary(detail, death);
  const rez = death.resurrectedBy;
  const caster = rez?.source != null ? roster.get(rez.source) : undefined;
  return (
    <div className="pdeath-entry">
      <div className="pdeath-line">
        {kb && <GameIcon name={hitName(kb, spell)} src={hitIconUrl(kb)} />}
        <span>
          <span className="num pdeath-time">{formatEventTime(death.t)}</span>
          {' · '}
          {kb ? t('player.killedBy', { spell: hitName(kb, spell), source: sourceLabel(kb) }) : t('deaths.noLethalHit')}
        </span>
      </div>
      {summary && <div className="pdeath-note">{summary}</div>}
      {death.resurrectedAt !== null && (
        <div className="pdeath-line">
          {rez && <GameIcon name={spell(rez.spellId)} src={spellIconUrl(rez.spellId)} />}
          <span>
            <span className="num pdeath-res">{formatEventTime(death.resurrectedAt)}</span>
            {rez && (
              <>
                {' · '}
                {spell(rez.spellId)}
              </>
            )}
            {caster && (
              <>
                {` ${t('player.rezBy')} `}
                <span style={{ color: classColor(caster.classToken) }}>{shortName(caster.name)}</span>
              </>
            )}
            {' · '}
            {t('player.deadFor', { seconds: formatCount(Math.floor((death.resurrectedAt - death.t) / 1000)) })}
          </span>
        </div>
      )}
    </div>
  );
}
