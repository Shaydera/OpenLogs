import type { ConsumableEntry, QuickOverview } from '../../api/types';
import { spellIcon } from '../../icons';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { GameIcon } from '../GameIcon';
import { PlayerName } from '../reports/PlayerName';
import type { ConsumableColumn } from './consumableModel';
import { consumableColumns, consumableLegend, rosterHalves } from './consumableModel';
import { sortedRoster, spellName, usedAtLabel } from './players';

export function ConsumablesPanel({ overview }: { overview: QuickOverview }) {
  // A missing potion is only a finding over the whole pull, not inside a short range.
  const inRange = useApp((s) => s.range) !== null;
  const columns = consumableColumns(overview);
  const legend = consumableLegend(overview, columns);
  const [first, second] = rosterHalves(sortedRoster(overview));
  const halves = second.length > 0 ? [first, second] : [first];
  const colClass = columns.length > 3 ? 'cons-col cons-wide' : 'cons-col';

  return (
    <section className="panel" aria-labelledby="consumables-title">
      <div className="panel-head panel-head-ov">
        <h2 id="consumables-title" className="h2">
          {t('consumables.title')}
        </h2>
        {legend.length > 0 && (
          <ul className="plain cons-legend" aria-label={t('consumables.legend')}>
            {legend.map((item) => (
              <li key={item.kind}>
                <GameIcon name={item.name} icon={spellIcon(item.spellId)} size={18} />
                {item.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="cons-cols">
        {halves.map((players, i) => (
          <div
            key={i}
            className={colClass}
            role="table"
            aria-label={t('consumables.part', { n: i + 1, total: halves.length })}
          >
            <div className="crow crow-head" role="row">
              <span className="cap" role="columnheader">
                {t('consumables.player')}
              </span>
              {columns.map((column) => (
                <span key={column.kind} className="cap" role="columnheader">
                  {t(column.label)}
                </span>
              ))}
            </div>
            {players.map((player) => (
              <div key={player.actorId} className="crow" role="row">
                <span className="crow-name" role="rowheader">
                  <PlayerName player={player} size={18} />
                </span>
                {columns.map((column) => (
                  <Cell
                    key={column.kind}
                    overview={overview}
                    column={column}
                    uses={overview.consumables.filter((u) => u.player === player.actorId && u.kind === column.kind)}
                    inRange={inRange}
                  />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function Cell({ overview, column, uses, inRange }: { overview: QuickOverview; column: ConsumableColumn; uses: ConsumableEntry[]; inRange: boolean }) {
  if (uses.length > 0) {
    return (
      <span role="cell">
        {uses.map((use) => (
          <span key={use.t} className="tchip">
            <GameIcon name={spellName(overview, use.spellId)} icon={spellIcon(use.spellId)} size={18} />
            {usedAtLabel(use.t)}
          </span>
        ))}
      </span>
    );
  }
  return (
    <span role="cell">
      {column.kind === 'combat_potion' && !inRange ? (
        <span className="missing">{t('consumables.missing')}</span>
      ) : (
        <span className="dash">—</span>
      )}
    </span>
  );
}
