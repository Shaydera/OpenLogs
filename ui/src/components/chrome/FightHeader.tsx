import { Fragment, type RefObject } from 'react';
import type { FightRow } from '../../api/types';
import { t } from '../../i18n/i18n';
import { pullStatus } from '../../pulls/groupPulls';
import { BossTile } from '../BossTile';
import { Kpi, KpiStrip } from '../Kpi';
import { fightMeta } from './fightMeta';
import type { HeaderTile } from './headerTiles';

/**
 * The pull header above the tabs: portrait, name, the result chip and the facts, and the
 * tab's key figures to the right. Without `tiles` (detail pages) it is one compact line, and the detail
 * page's own title stays the page's heading.
 */
export function FightHeader({ row, tiles, titleRef }: { row: FightRow; tiles: HeaderTile[] | null; titleRef: RefObject<HTMLHeadingElement | null> }) {
  const status = pullStatus(row);
  const chip = { className: status === 'kill' ? 'kill' : status === 'aborted' ? 'abort' : 'wipe', label: t(`status.${status}`) };
  const meta = fightMeta(row);
  const compact = tiles === null;
  return (
    <section className={compact ? 'fight-header fight-header-compact' : 'fight-header'} aria-labelledby="fight-title">
      <BossTile encounterId={row.encounterId} name={row.name} large={!compact} />
      <div className="fight-id">
        {compact ? (
          <p id="fight-title" className="fight-name">
            {row.name}
          </p>
        ) : (
          <h1 id="fight-title" ref={titleRef} tabIndex={-1} className="fight-name">
            {row.name}
          </h1>
        )}
        <div className="fight-meta">
          <span className={`chip ${chip.className}`}>{chip.label}</span>
          {meta.map((item, i) => (
            <Fragment key={`${i}-${item.text}`}>
              {i > 0 && <span aria-hidden="true">·</span>}
              <span className={item.mono ? 'num' : undefined}>{item.text}</span>
            </Fragment>
          ))}
        </div>
      </div>
      {tiles && (
        <KpiStrip label={t('overview.kpis')} large>
          {tiles.map((tile) => (
            <Kpi key={tile.label} label={tile.label} value={tile.value} sub={tile.sub} tone={tile.tone} subTone={tile.subTone} />
          ))}
        </KpiStrip>
      )}
    </section>
  );
}
