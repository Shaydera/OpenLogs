import { Fragment, type RefObject } from 'react';
import type { FightRow, LogView, PullSet } from '../../api/types';
import { formatDuration, formatKeystoneLevel } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { PULL_CHIP, RUN_CHIP, isCombatPull, moreEnemies, pullStatus, runStatus } from '../../pulls/groupPulls';
import { BossTile } from '../BossTile';
import { CombatName } from '../CombatName';
import { Kpi, KpiStrip } from '../Kpi';
import { type MetaItem, fightMeta, pullKind, setIdentity, setMeta } from './fightMeta';
import type { HeaderTile } from './headerTiles';

/**
 * The pull header above the tabs: portrait, name, the result chip and the facts, and the
 * tab's key figures to the right. Without `tiles` (detail pages) it is one compact line, and the detail
 * page's own title stays the page's heading.
 */
function fightIdentity(row: FightRow): Pick<Heading, 'title' | 'moreEnemies' | 'chip'> {
  const run = row.run;
  const status = pullStatus(row);
  const title = run ? t('runs.heading', { dungeon: row.name, level: formatKeystoneLevel(run.keystoneLevel) }) : row.name;
  const chip = run
    ? { className: RUN_CHIP[runStatus(row)], label: t(`runs.status.${runStatus(row)}`) }
    : { className: PULL_CHIP[status], label: t(`status.${status}`) };
  return { title, moreEnemies: isCombatPull(row) ? moreEnemies(row.combat) : 0, chip };
}

/** What the header shows of a pull or a pull set. */
export interface Heading {
  title: string;
  /** A combat pull's further enemies, a `+N` after the title. */
  moreEnemies: number;
  chip: { className: string; label: string };
  meta: MetaItem[];
  portrait: { encounterId: number; name: string };
  /** A pull set: its facts line is longer than a pull's. */
  set: boolean;
}

export function pullHeading(row: FightRow): Heading {
  return { ...fightIdentity(row), meta: fightMeta(row), portrait: { encounterId: row.run ? 0 : row.encounterId, name: row.name }, set: false };
}

/** `players` is `null` until the set's overview is read. */
export function setHeading(log: LogView, set: PullSet, players: number | null): Heading {
  const identity = setIdentity(log, set);
  return {
    title: identity.name,
    moreEnemies: 0,
    chip: { className: 'chip-set', label: t('fight.setChip', { set: t(`pulls.set.${set.kind}`), count: set.fights.length }) },
    meta: setMeta(identity, players),
    portrait: { encounterId: set.encounterId, name: identity.name },
    set: true,
  };
}

function Title({ title, moreEnemies: more }: Pick<Heading, 'title' | 'moreEnemies'>) {
  return more > 0 ? <CombatName name={title} more={more} /> : title;
}

function MetaText({ item }: { item: MetaItem }) {
  if (!item.suffix) return <span className={item.mono ? 'num' : undefined}>{item.text}</span>;
  return (
    <span>
      <span className={item.mono ? 'num' : undefined}>{item.text}</span> {item.suffix}
    </span>
  );
}

export function FightHeader({ heading, tiles, titleRef }: { heading: Heading; tiles: HeaderTile[] | null; titleRef: RefObject<HTMLHeadingElement | null> }) {
  const { chip, meta, portrait } = heading;
  const title = <Title title={heading.title} moreEnemies={heading.moreEnemies} />;
  const compact = tiles === null;
  const className = ['fight-header', compact && 'fight-header-compact', heading.set && 'fight-header-set'].filter(Boolean).join(' ');
  return (
    <section className={className} aria-labelledby="fight-title">
      <BossTile encounterId={portrait.encounterId} name={portrait.name} large={!compact} />
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
              <MetaText item={item} />
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

/** The replay's pull line at the start of the tab row: small portrait, name, result chip, difficulty or "Combat pull", and duration. */
export function FightHeading({ row, titleRef }: { row: FightRow; titleRef: RefObject<HTMLHeadingElement | null> }) {
  const { title, moreEnemies: more, chip } = fightIdentity(row);
  return (
    <div className="fight-heading">
      <BossTile encounterId={row.run ? 0 : row.encounterId} name={row.name} />
      <h1 id="fight-title" ref={titleRef} tabIndex={-1} className="fight-heading-name">
        <Title title={title} moreEnemies={more} />
      </h1>
      <span className={`chip ${chip.className}`}>{chip.label}</span>
      <span className="fight-heading-facts">
        {pullKind(row)}
        <span aria-hidden="true"> · </span>
        <span className="num">{formatDuration(row.durationMs)}</span>
      </span>
    </div>
  );
}
