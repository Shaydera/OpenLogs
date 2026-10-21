import { Fragment, useState } from 'react';
import type { EventRow, EventsPage, SharePart } from '../../api/types';
import { formatEventTimeMs, formatInteger, formatScaled } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import type { FilterTab } from '../../scopeSides';
import { EVENTS_PAGE_ROWS, type ViewToggles, analysedEndMs, replayOffered, replaySplitShown, useApp } from '../../store';
import { spellIcon } from '../../icons';
import { GameIcon } from '../GameIcon';
import { NoMatch } from '../filters/NoMatch';
import { captionOf } from '../filters/sides';
import { hitIcon } from '../reports/reportData';
import { deathJumpMs } from '../replay/playback';
import { VALUE_CAPTION, fieldsOf, hitNoteOf, isStackRow, noteOf, sentenceOf, textNoteOf, textValueOf, typeLabel, valueOf } from './eventColumns';
import { TAB_TITLE, ViewFailure, ViewHead } from './ViewHead';
import { type ViewNames, viewNames } from './viewNames';

const TOGGLES: Partial<Record<FilterTab, (keyof ViewToggles)[]>> = { casts: ['beginCasts', 'rejected'] };
const AMOUNT_TABS: FilterTab[] = ['damage', 'healing', 'taken'];

/** A recap line can repeat under two deaths whose windows overlap, so the index alone is not an identity. */
const rowKey = (row: EventRow) => `${row.index}-${row.contextOf ?? 'own'}-${row.type}`;

/** "Wild Imp (Wendel)": a pet keeps its own name; its owner follows. */
function UnitName({ actorId, names, fallback }: { actorId: number; names: ViewNames; fallback: string }) {
  const name = names.unit(actorId);
  const owner = names.owner(actorId);
  return (
    <>
      <span style={{ color: names.colour(actorId) }}>{name || fallback}</span>
      {owner && <span className="note">({owner})</span>}
    </>
  );
}

function TargetHp({ tab, row }: { tab: FilterTab; row: EventRow }) {
  if (tab !== 'taken' || !row.targetHp) return null;
  return <span className="faint num">{t('events.targetHp', { current: formatScaled(row.targetHp[0]), max: formatScaled(row.targetHp[1]) })}</span>;
}

function Shares({ shares, names }: { shares: SharePart[]; names: ViewNames }) {
  return shares.map((share, i) => {
    const text = t('events.share', { buff: names.spell(share.buffId), evoker: names.unit(share.evoker) });
    return (
      <span key={i} className={share.selected ? 'schip on' : 'schip'} title={text}>
        <GameIcon icon={spellIcon(share.buffId)} size={16} name={names.spell(share.buffId)} />
        {formatScaled(share.amount)}
        <span className="sr-only">{text}</span>
      </span>
    );
  });
}

/** The logged count as a badge and one pip per stack; the log names no maximum, so none is drawn. */
function StackCount({ count }: { count: number }) {
  return (
    <span className="ev-stack">
      <span aria-hidden="true">{formatInteger(count)}</span>
      <span className="sr-only">{t('events.stacks', { count })}</span>
    </span>
  );
}

/** Beyond this many stacks the pips stop and a "+" follows; the badge keeps the logged count. */
const MAX_PIPS = 10;

function StackPips({ count }: { count: number }) {
  return (
    <span className="ev-pips" aria-hidden="true">
      {Array.from({ length: Math.min(count, MAX_PIPS) }, (_, i) => (
        <i key={i} />
      ))}
      {count > MAX_PIPS && <b>+</b>}
    </span>
  );
}

function Note({ text }: { text: string }) {
  return text ? <span className="erow-note faint">{text}</span> : null;
}

const sourceFallback = (row: EventRow) => (row.environmental ? t('scope.environment') : row.unknownBlow ? t('events.noSource') : t('deaths.unknownSource'));
const spellText = (row: EventRow, names: ViewNames) => (row.unknownBlow ? t('events.noBlow') : names.spell(row.spellId));
const replayAt = (row: EventRow) => (row.type === 'died' ? deathJumpMs(row.t) : row.t);

/** One line per event of the tab in the range, a page at a time, in log order. */
export function EventsView({ tab }: { tab: FilterTab }) {
  const page = useApp((s) => s.events);
  const viewError = useApp((s) => s.viewError);
  const reportError = useApp((s) => s.reportError);
  const viewLoading = useApp((s) => s.viewLoading);
  const layout = useApp((s) => s.eventsLayout);
  const setEventsLayout = useApp((s) => s.setEventsLayout);
  const showEventsPage = useApp((s) => s.showEventsPage);
  const perspective = useApp((s) => s.scope.perspective);
  const range = useApp((s) => s.range);
  const durationMs = useApp((s) => (s.overview ? analysedEndMs(s.overview) : 0));
  const [open, setOpen] = useState<string | null>(null);
  const title = t('events.title', { tab: t(TAB_TITLE[tab]) });
  const head = (summary?: string) => <ViewHead tab={tab} id="events-title" title={title} summary={summary && <span className="view-summary">{summary}</span>} toggles={TOGGLES[tab] ?? []} />;
  const failure = viewError ?? (page ? null : reportError);
  const status = (
    <p className="sr-only" role="status">
      {viewLoading ? t('report.loading') : ''}
    </p>
  );
  const failed = failure !== null && <ViewFailure reason={failure} retry={viewError !== null} />;
  if (!page) {
    return (
      <section className="panel" aria-labelledby="events-title">
        {head()}
        {status}
        {failed || (!viewLoading && <p className="muted pad">{t('events.notLoaded')}</p>)}
      </section>
    );
  }
  const names = viewNames(page);
  const from = range?.startMs ?? 0;
  const to = range?.endMs ?? durationMs;
  const summary = [
    t(perspective === 'friendly' ? 'scope.friendlies' : 'scope.enemies'),
    `${formatEventTimeMs(from)} – ${formatEventTimeMs(to)}`,
    AMOUNT_TABS.includes(tab) ? t('events.asLogged') : null,
    page.amount !== null ? t('events.sum', { amount: formatScaled(page.amount) }) : null,
    page.unlistedSupport !== 0 ? t('events.unlisted', { amount: formatScaled(page.unlistedSupport) }) : null,
    page.hiddenProcs > 0 ? t('events.procsHidden', { count: page.hiddenProcs }) : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
  const turn = (offset: number) => {
    setOpen(null);
    void showEventsPage(offset);
  };
  return (
    <section className="panel" aria-labelledby="events-title">
      {head(summary)}
      {status}
      {failed}
      {page.total === 0 ? (
        <NoMatch nothing={t('events.nothing')} />
      ) : (
        <div className={viewLoading ? 'dim' : undefined}>
          <div className="events-bar">
            <div className="events-layout" role="group" aria-label={t('events.layout')}>
              {(['grid', 'text'] as const).map((option) => (
                <button key={option} type="button" className={option === layout ? 'vbtn on' : 'vbtn'} aria-pressed={option === layout} onClick={() => setEventsLayout(option)}>
                  {t(`events.${option}`)}
                </button>
              ))}
            </div>
            <Pager page={page} busy={viewLoading} onPage={turn} />
          </div>
          {layout === 'grid' ? (
            <EventsGrid tab={tab} page={page} names={names} open={open} busy={viewLoading} onOpen={setOpen} />
          ) : (
            <div className="events-text" aria-busy={viewLoading}>
              {page.rows.map((row) => (
                <p key={rowKey(row)} className={row.contextOf === null ? 'tline' : 'tline context'}>
                  <span className="num muted">{formatEventTimeMs(row.t)}</span>
                  <span>{sentenceOf(tab, row, names)}</span>
                  <span className="num">{textValueOf(tab, row, names)}</span>
                  <Shares shares={row.shares} names={names} />
                  <TargetHp tab={tab} row={row} />
                  <span className="faint">{textNoteOf(row, names)}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Pager({ page, busy, onPage }: { page: EventsPage; busy: boolean; onPage: (offset: number) => void }) {
  const counted = page.rows.filter((row) => row.contextOf === null).length;
  const last = Math.max(0, Math.floor((page.total - 1) / EVENTS_PAGE_ROWS) * EVENTS_PAGE_ROWS);
  const atStart = busy || page.offset === 0;
  const atEnd = busy || page.offset + EVENTS_PAGE_ROWS >= page.total;
  return (
    <div className="pager" role="group" aria-label={t('events.pager')}>
      <span className="muted">{t('events.rows', { from: formatInteger(page.offset + 1), to: formatInteger(page.offset + counted), total: formatInteger(page.total) })}</span>
      <button type="button" className="lnk" disabled={atStart} onClick={() => onPage(0)}>
        {t('events.first')}
      </button>
      <button type="button" className="lnk" disabled={atStart} onClick={() => onPage(Math.max(0, page.offset - EVENTS_PAGE_ROWS))}>
        {t('events.previous')}
      </button>
      <button type="button" className="lnk" disabled={atEnd} onClick={() => onPage(page.offset + EVENTS_PAGE_ROWS)}>
        {t('events.next')}
      </button>
      <button type="button" className="lnk" disabled={atEnd} onClick={() => onPage(last)}>
        {t('events.last')}
      </button>
    </div>
  );
}

function EventsGrid(props: { tab: FilterTab; page: EventsPage; names: ViewNames; open: string | null; busy: boolean; onOpen: (key: string | null) => void }) {
  const { tab, page, names, open, busy, onOpen } = props;
  const split = useApp(replaySplitShown);
  const withReplay = useApp(replayOffered);
  const setReplayTime = useApp((s) => s.setReplayTime);
  const openReplayAt = useApp((s) => s.openReplayAt);
  const narrowed = new Set(page.narrowed);
  const showAbility = !narrowed.has('ability');
  const showSource = !narrowed.has('source');
  const showTarget = !narrowed.has('target');
  const showUnits = showSource || showTarget;
  const stacksInAbility = tab === 'buffs' && showAbility;
  const castTimeInAbility = tab === 'casts' && showAbility;
  const showValue = !stacksInAbility && !castTimeInAbility;
  const columns = ['98px', '150px', showAbility && 'minmax(220px, 1.3fr)', showValue && 'minmax(200px, 1fr)', showUnits && 'minmax(200px, 1.2fr)'].filter(Boolean).join(' ');
  const captions = { source: captionOf(tab, 'source'), target: captionOf(tab, 'target'), ability: captionOf(tab, 'ability') };
  return (
    <div className="events-scroll">
      <div className="events-grid" role="table" aria-busy={busy} aria-label={t('events.title', { tab: t(TAB_TITLE[tab]) })}>
        <div className="erow head" role="row" style={{ gridTemplateColumns: columns }}>
          <span className="cap" role="columnheader">{t('events.column.time')}</span>
          <span className="cap end" role="columnheader">{t('events.column.type')}</span>
          {showAbility && <span className="cap" role="columnheader">{captions.ability}</span>}
          {showValue && <span className="cap end" role="columnheader">{t(VALUE_CAPTION[tab])}</span>}
          {showUnits && (
            <span className="cap" role="columnheader">
              {[showSource && captions.source, showTarget && captions.target].filter(Boolean).join(' → ')}
            </span>
          )}
        </div>
        {page.rows.map((row, i) => {
          const key = rowKey(row);
          const expanded = open === key;
          const fieldsId = `events-fields-${key}`;
          const above = page.rows[i - 1];
          const sameTime = above !== undefined && above.t === row.t && open !== rowKey(above);
          const time = formatEventTimeMs(row.t);
          const label = typeLabel(row);
          const note = noteOf(row, names);
          const stacks = stacksInAbility && isStackRow(row) ? row.stacks : null;
          return (
            <Fragment key={key}>
              <div role="row" className={row.contextOf === null ? 'erow' : 'erow context'} style={{ gridTemplateColumns: columns }}>
                <span role="cell" className="erow-time num muted">
                  <button
                    type="button"
                    className={sameTime ? 'erow-open same-time' : 'erow-open'}
                    aria-expanded={expanded}
                    aria-controls={expanded ? fieldsId : undefined}
                    aria-label={t('events.toggle', { type: label, time })}
                    onClick={() => {
                      onOpen(expanded ? null : key);
                      if (split) setReplayTime(replayAt(row));
                    }}
                  >
                    {sameTime ? null : time}
                  </button>
                </span>
                <span role="cell" className="erow-type">
                  {label}
                  <i className="ev-dot" data-kind={row.type} aria-hidden="true" />
                </span>
                {showAbility && (
                  <span role="cell" className={stacks === null ? 'erow-spell' : 'erow-spell nested'}>
                    {stacks !== null && <StackCount count={stacks} />}
                    {!row.unknownBlow && <GameIcon icon={hitIcon({ spellId: row.spellId, environmental: row.environmental })} size={18} name={names.spell(row.spellId)} />}
                    <span className="nm">{spellText(row, names)}</span>
                    {stacks !== null && <StackPips count={stacks} />}
                    <Note text={note} />
                  </span>
                )}
                {showValue && (
                  <span role="cell" className="erow-value">
                    {!showAbility && <Note text={note} />}
                    <Note text={hitNoteOf(row)} />
                    <Shares shares={row.shares} names={names} />
                    <TargetHp tab={tab} row={row} />
                    <span className={row.critical ? 'num crit' : 'num'}>{valueOf(tab, row, names)}</span>
                  </span>
                )}
                {showUnits && (
                  <span role="cell" className="nm">
                    {showSource && <UnitName actorId={row.source} names={names} fallback={sourceFallback(row)} />}
                    {showSource && showTarget && <span className="erow-arrow"> → </span>}
                    {showTarget && <UnitName actorId={row.target} names={names} fallback={t('events.noTarget')} />}
                  </span>
                )}
              </div>
              {expanded && (
                <div role="row">
                  <div role="cell" id={fieldsId}>
                    <dl className="erow-fields">
                      {fieldsOf(row, names).map((field) => (
                        <div key={field.key}>
                          <dt className="cap">{t(field.key)}</dt>
                          <dd className="num">{field.value}</dd>
                        </div>
                      ))}
                    </dl>
                    {withReplay && !split && (
                      <button type="button" className="lnk erow-replay" onClick={() => openReplayAt(replayAt(row))}>
                        {t('replay.showIn')}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
