import type { DeathEntry, PlayerRef, QuickOverview } from '../../api/types';
import { specIcon, spellIcon } from '../../icons';
import { formatAmountWhole, formatEventTime, formatPercent } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { GameIcon } from '../GameIcon';
import { hitIcon, hitName } from '../reports/reportData';
import { contextBadges, damageParts, deathSource } from './deathModel';
import { classColor, playerIndex, shortName, spellName } from './players';

const MAX_ROWS = 5;

export function DeathsPanel({ overview }: { overview: QuickOverview }) {
  const range = useApp((s) => s.range);
  const setTab = useApp((s) => s.setTab);
  const players = playerIndex(overview);
  const shown = overview.deaths.slice(0, MAX_ROWS);

  return (
    <section className="panel" aria-labelledby="deaths-title">
      <div className="panel-head panel-head-ov">
        <h2 id="deaths-title" className="h2">
          {t('deaths.title')}
        </h2>
        <button type="button" className="panel-link" onClick={() => void setTab('deaths')}>
          {t('deaths.allLink')}
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="muted pad">{t(range ? 'deaths.noneInRange' : 'deaths.none')}</p>
      ) : (
        <div className="death-scroll">
          <div className="death-table">
            <div className="death-row death-head" aria-hidden="true">
              <span className="cap">{t('deaths.column.time')}</span>
              <span className="cap">{t('deaths.column.player')}</span>
              <span className="cap">{t('deaths.column.killingBlow')}</span>
              <span className="cap">{t('deaths.column.lastSeconds')}</span>
              <span className="cap">{t('deaths.column.context')}</span>
            </div>
            <ol className="death-list">
              {shown.map((death, i) => (
                <DeathRow
                  key={`${death.player}-${death.t}`}
                  n={i + 1}
                  death={death}
                  player={players.get(death.player)}
                  overview={overview}
                />
              ))}
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}

function DeathRow({ n, death, player, overview }: { n: number; death: DeathEntry; player: PlayerRef | undefined; overview: QuickOverview }) {
  const openDeathRecap = useApp((s) => s.openDeathRecap);
  const name = shortName(death.playerName);
  const kb = death.killingBlow;
  const kbName = kb ? hitName(kb, (id) => spellName(overview, id)) : '';
  const parts = damageParts(overview, death);
  return (
    <li className="death-row" aria-label={t('deaths.row', { n, name })}>
      <div className="death-when">
        <span className="num death-time">{formatEventTime(death.t)}</span>
        <span className="death-n">{t('deaths.ordinal', { n })}</span>
      </div>
      <div className="death-player">
        {player && player.specId !== null && <GameIcon icon={specIcon(player.specId)} size={22} name={name} />}
        <button
          type="button"
          className="link-btn death-who"
          aria-label={t('deaths.openRecapOf', { name })}
          onClick={() => void openDeathRecap(death.player, death.t)}
        >
          <span className="death-name" style={{ color: classColor(player?.classToken ?? null) }} title={name}>
            {name}
          </span>
          {player?.specName && <span className="death-spec">{player.specName}</span>}
        </button>
      </div>
      <div className="death-kb">
        {kb ? (
          <>
            <GameIcon name={kbName} icon={hitIcon(kb)} size={32} />
            <div className="death-kb-text">
              <span className="death-kb-name">{kbName}</span>
              <span className="death-by">{t('deaths.by', { source: deathSource(kb) })}</span>
              <span className="num death-amounts">
                <span className="death-amount">{formatAmountWhole(kb.amount)}</span>{' '}
                <span className="death-overkill">{t('deaths.overkill', { amount: formatAmountWhole(kb.overkill) })}</span>
              </span>
            </div>
          </>
        ) : (
          <span className="death-by">{t('deaths.noLethalHit')}</span>
        )}
      </div>
      <div className="death-taken">
        <div className="death-taken-head">
          <span className="death-hp">
            {t('deaths.hpBeforeLabel')}{' '}
            <span className="num">{death.hpBeforePct === null ? '—' : formatPercent(death.hpBeforePct)}</span>
          </span>
          <span className="num death-total">{t('deaths.total', { amount: formatAmountWhole(death.damageTaken5s) })}</span>
        </div>
        <div className="seg5" aria-hidden="true">
          {parts.map((part) => (
            <span key={part.key} style={{ width: `${part.widthPct}%`, background: `var(--segment-${part.tone})` }} />
          ))}
        </div>
        <ul className="plain seg5-legend">
          {parts.map((part) => (
            <li key={part.key}>
              <span className="seg5-dot" style={{ background: `var(--segment-${part.tone})` }} />
              <GameIcon name={part.name} icon={part.icon} size={18} />
              <span>{part.name}</span>
              <span className="num">{part.amount}</span>
            </li>
          ))}
        </ul>
      </div>
      <ul className="plain badges">
        {contextBadges(overview, death).map((badge) => (
          <li key={badge.key}>
            <span className={`badge ${badge.tone}`}>
              <GameIcon name={badge.name} icon={spellIcon(badge.spellId)} size={18} />
              <span>{badge.name}</span>
              <span className="badge-state">{badge.state}</span>
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}
