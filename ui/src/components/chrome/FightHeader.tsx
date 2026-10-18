import { Fragment, type RefObject } from 'react';
import type { FightRow } from '../../api/types';
import { formatDuration, formatKeystoneLevel } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { RUN_CHIP, difficultyName, pullStatus, runStatus } from '../../pulls/groupPulls';
import { BossTile } from '../BossTile';
import { Kpi, KpiStrip } from '../Kpi';
import { fightMeta } from './fightMeta';
import type { HeaderTile } from './headerTiles';

/**
 * The pull header above the tabs: portrait, name, the result chip and the facts, and the
 * tab's key figures to the right. Without `tiles` (detail pages) it is one compact line, and the detail
 * page's own title stays the page's heading.
 */
function fightIdentity(row: FightRow): { title: string; chip: { className: string; label: string } } {
  const run = row.run;
  const status = pullStatus(row);
  const title = run ? t('runs.heading', { dungeon: row.name, level: formatKeystoneLevel(run.keystoneLevel) }) : row.name;
  const chip = run
    ? { className: RUN_CHIP[runStatus(row)], label: t(`runs.status.${runStatus(row)}`) }
    : { className: status === 'kill' ? 'kill' : status === 'aborted' ? 'abort' : 'wipe', label: t(`status.${status}`) };
  return { title, chip };
}

export function FightHeader({ row, tiles, titleRef }: { row: FightRow; tiles: HeaderTile[] | null; titleRef: RefObject<HTMLHeadingElement | null> }) {
  const run = row.run;
  const { title, chip } = fightIdentity(row);
  const meta = fightMeta(row);
  const compact = tiles === null;
  return (
    <section className={compact ? 'fight-header fight-header-compact' : 'fight-header'} aria-labelledby="fight-title">
      <BossTile encounterId={run ? 0 : row.encounterId} name={row.name} large={!compact} />
      <div className="fight-id">
        {compact ? (
          <p id="fight-title" className="fight-name">
            {title}
          </p>
        ) : (
          <h1 id="fight-title" ref={titleRef} tabIndex={-1} className="fight-name">
            {title}
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

/** The replay's pull line at the start of the tab row: small portrait, name, result chip, difficulty and duration. */
export function FightHeading({ row, titleRef }: { row: FightRow; titleRef: RefObject<HTMLHeadingElement | null> }) {
  const { title, chip } = fightIdentity(row);
  return (
    <div className="fight-heading">
      <BossTile encounterId={row.run ? 0 : row.encounterId} name={row.name} />
      <h1 id="fight-title" ref={titleRef} tabIndex={-1} className="fight-heading-name">
        {title}
      </h1>
      <span className={`chip ${chip.className}`}>{chip.label}</span>
      <span className="fight-heading-facts">
        {difficultyName(row)}
        <span aria-hidden="true"> · </span>
        <span className="num">{formatDuration(row.durationMs)}</span>
      </span>
    </div>
  );
}
