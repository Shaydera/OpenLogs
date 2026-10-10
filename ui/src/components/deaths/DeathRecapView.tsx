import type { DeathRecap, DeathsReport } from '../../api/types';
import { spellIconUrl } from '../../icons';
import { t } from '../../i18n/i18n';
import { GameIcon } from '../GameIcon';
import { shortName } from '../overview/players';
import { hitIconUrl, reportSpellName } from '../reports/reportData';
import { RecapPanel } from './RecapPanel';
import { contextRows, recapRows, type ContextRow } from './recapModel';

export function DeathRecapView({ recap, report }: { recap: DeathRecap; report: DeathsReport }) {
  const spellName = (id: number) => reportSpellName(report.spells, id);
  const rows = recapRows(recap, spellName);
  const { defensives, consumables } = contextRows(recap, spellName);
  const events = t('recap.events');

  return (
    <>
      <RecapPanel recap={recap} report={report} />
      <div className="recap-lower">
        <section className="panel panel-clip recap-events" aria-labelledby="recap-events-title">
          <div className="panel-head panel-head-events">
            <h3 id="recap-events-title" className="h2">
              {events}
            </h3>
            <span className="panel-hint">{t('recap.eventsOn', { name: shortName(recap.playerName) })}</span>
          </div>
          {rows.length === 0 ? (
            <p className="muted pad">{t('recap.noEvents')}</p>
          ) : (
            <div className="scroll-x">
              <div className="rev-rows" role="table" aria-label={events}>
                <div className="rev-row rev-row-head" role="row">
                  <span role="columnheader" className="cap rev-cap">
                    {t('ability.time')}
                  </span>
                  <span role="columnheader">
                    <span className="sr-only">{t('recap.iconColumn')}</span>
                  </span>
                  <span role="columnheader" className="cap rev-cap">
                    {t('report.ability')}
                  </span>
                  <span role="columnheader" className="cap rev-cap">
                    {t('recap.source')}
                  </span>
                  <span role="columnheader" className="cap rev-cap rev-cap-end">
                    {t('report.amount')}
                  </span>
                  <span role="columnheader" className="cap rev-cap rev-cap-end">
                    {t('recap.hp')}
                  </span>
                </div>
                {rows.map((row) => {
                  const damage = row.event.kind === 'damage';
                  return (
                    <div key={row.key} role="row" className={row.tone ? `rev-row rev-row-${row.tone}` : 'rev-row'}>
                      <span role="cell" className="num rev-time">
                        {row.time}
                      </span>
                      <span role="cell">
                        <GameIcon name={row.name} src={hitIconUrl(row.event)} size={18} />
                      </span>
                      <span role="cell" className={damage ? 'rev-ability rev-ability-dmg' : 'rev-ability'}>
                        {row.name}
                      </span>
                      <span role="cell" className="rev-source">
                        {row.source}
                      </span>
                      <span role="cell" className={damage ? 'num rev-amount rev-amount-dmg' : 'num rev-amount rev-amount-heal'}>
                        {row.amount}
                      </span>
                      <span role="cell" className="num rev-hp">
                        {row.hp}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
        <aside className="panel panel-clip recap-context" aria-labelledby="recap-context-title">
          <div className="panel-head panel-head-tight">
            <h3 id="recap-context-title" className="h2">
              {t('recap.context')}
            </h3>
          </div>
          {defensives.length > 0 && <ContextGroup caption={t('recap.defensives')} rows={defensives} first />}
          {consumables.length > 0 && <ContextGroup caption={t('consumables.title')} rows={consumables} first={defensives.length === 0} />}
        </aside>
      </div>
    </>
  );
}

function ContextGroup({ caption, rows, first }: { caption: string; rows: ContextRow[]; first: boolean }) {
  return (
    <>
      <div className={first ? 'cap ctx-cap' : 'cap ctx-cap ctx-cap-gap'} aria-hidden="true">
        {caption}
      </div>
      <ul className="ctx-list" aria-label={caption}>
        {rows.map((row) => (
          <li key={row.key} className="ctx-row">
            <GameIcon name={row.name} src={spellIconUrl(row.spellId)} size={18} />
            <span className="ctx-name">
              {row.name}
              {row.when && (
                <>
                  {' '}
                  <span className="num ctx-when">{row.when}</span>
                </>
              )}
            </span>
            <span className={`st ${row.tone}`}>{row.state}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
