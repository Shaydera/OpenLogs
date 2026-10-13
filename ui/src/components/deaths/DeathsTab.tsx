import type { DeathsReport } from '../../api/types';
import { formatEventTime } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { GameIcon, MonogramTile } from '../GameIcon';
import { classColor, shortName } from '../overview/players';
import { hitIcon, hitName, reportSpellName, rosterIndex } from '../reports/reportData';
import { DeathRecapView } from './DeathRecapView';
import { hitSource } from './recapModel';

export function DeathsTab({ report }: { report: DeathsReport }) {
  const focus = useApp((s) => s.focusDeath);
  const selectDeath = useApp((s) => s.selectDeath);
  const range = useApp((s) => s.range);
  if (report.deaths.length === 0) {
    return (
      <section className="panel" aria-labelledby="deaths-empty-title">
        <div className="panel-head panel-head-tight">
          <h2 id="deaths-empty-title" className="h2">
            {t('tabs.deaths')}
          </h2>
        </div>
        <p className="muted pad">{t(range ? 'deaths.noneInRange' : 'deaths.none')}</p>
      </section>
    );
  }
  // Picked by (player, time): a range change keeps the death or falls back to the first.
  const index = Math.max(0, focus ? report.deaths.findIndex((d) => d.player === focus.player && d.t === focus.t) : 0);
  const roster = rosterIndex(report.roster);
  const spellName = (id: number) => reportSpellName(report.spells, id);
  const label = t('recap.all', { count: report.deaths.length });
  return (
    <div className="deaths-page">
      <aside className="panel panel-clip deaths-list" aria-labelledby="deaths-list-title">
        <div className="panel-head panel-head-tight">
          <h2 id="deaths-list-title" className="h2">
            {label}
          </h2>
        </div>
        <div role="group" aria-label={label}>
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
                  <span className="dlink-name" style={{ color: classColor(roster.get(death.player)?.classToken ?? null) }} title={name}>
                    {name}
                  </span>
                  <span className="dlink-blow">{kb ? t('deaths.blowShort', { spell: blow, source: hitSource(kb) }) : t('deaths.noLethalHit')}</span>
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
