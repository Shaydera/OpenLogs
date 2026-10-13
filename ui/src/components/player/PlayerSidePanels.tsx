import type { PlayerDeath, PlayerDetail, PlayerRef, SpellAmount } from '../../api/types';
import { spellIcon } from '../../icons';
import { formatCount, formatEventTime, formatMillions } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { GameIcon } from '../GameIcon';
import { classColor, shortName } from '../overview/players';
import { hitIcon, hitName, reportSpellName, rosterIndex, sourceLabel } from '../reports/reportData';
import { TargetBreakdown, targetRows } from '../reports/TargetParts';
import { targetColors } from '../reports/targetGroups';
import { deathSummary } from './deathSummary';

/** How many targets the Targets panel lists before "Other". */
const PANEL_TARGETS = 8;

/** Spell rows; `environmental` marks world damage, which shares spell 0 with melee. */
type SpellRow = SpellAmount & { environmental?: boolean };

/** Icon, name over a bar, the amount in millions. */
function SpellList({ rows, detail, label, empty }: { rows: SpellRow[]; detail: PlayerDetail; label: string; empty: string }) {
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
              <GameIcon name={name} icon={hitIcon(hit)} size={18} />
            </span>
            <span role="cell" className="lst-name">
              <span>{name}</span>
              <span className="bar bar-sm" aria-hidden="true">
                <span className="lst-fill-taken" style={{ width: `${(row.amount / largest) * 100}%` }} />
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
  const { colorOf } = targetColors(detail.metric, detail.colorGroups, roster);
  const name = shortName(detail.player.name);
  return (
    <div className="player-panels">
      <section className="panel pp-wide" id="p-targets" aria-labelledby="player-targets-title">
        <div className="panel-head panel-head-tight">
          <div>
            <h2 id="player-targets-title" tabIndex={-1} className="h2">
              {t(healing ? 'targets.healedPlayers' : 'targets.title')}
            </h2>
            <div className="panel-sub">{t(healing ? 'player.healedHint' : 'player.targetsHint')}</div>
          </div>
        </div>
        {detail.targets.length === 0 ? (
          <p className="muted pad">{t('targets.none')}</p>
        ) : (
          <TargetBreakdown
            caption={t(healing ? 'targets.healedOf' : 'targets.of', { name })}
            nameLabel={t(healing ? 'targets.player' : 'targets.target')}
            amountLabel={t(healing ? 'report.healing' : 'report.damage')}
            rows={targetRows(detail.targets, { total: detail.total, roster, colorOf, top: PANEL_TARGETS })}
          />
        )}
      </section>
      <section className="panel pp-wide" id="p-taken" aria-labelledby="player-taken-title">
        <div className="panel-head panel-head-tight">
          <div>
            <h2 id="player-taken-title" tabIndex={-1} className="h2">
              {t('player.damageTaken')}
            </h2>
            <div className="panel-sub">{t('player.takenHint', { name })}</div>
          </div>
        </div>
        <SpellList rows={detail.takenBySpell} detail={detail} label={t('player.damageTaken')} empty={t('player.noTaken')} />
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
  const openDeathRecap = useApp((s) => s.openDeathRecap);
  const spell = (id: number) => reportSpellName(detail.spells, id);
  const kb = death.killingBlow;
  const summary = deathSummary(detail, death);
  const rez = death.resurrectedBy;
  const caster = rez?.source != null ? roster.get(rez.source) : undefined;
  return (
    <div className="pdeath-entry">
      <div className="pdeath-line">
        {kb && <GameIcon name={hitName(kb, spell)} icon={hitIcon(kb)} />}
        <span>
          <span className="num pdeath-time">{formatEventTime(death.t)}</span>
          {' · '}
          {kb ? t('player.killedBy', { spell: hitName(kb, spell), source: sourceLabel(kb) }) : t('deaths.noLethalHit')}
        </span>
      </div>
      {summary && <div className="pdeath-note">{summary}</div>}
      {death.resurrectedAt !== null && (
        <div className="pdeath-line">
          {rez && <GameIcon name={spell(rez.spellId)} icon={spellIcon(rez.spellId)} />}
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
      <button type="button" className="accent-link" onClick={() => void openDeathRecap(detail.player.actorId, death.t)}>
        {t('player.openRecap')}
        <span className="sr-only"> {formatEventTime(death.t)}</span>
      </button>
    </div>
  );
}
