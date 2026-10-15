import { type CSSProperties, Fragment, type MouseEvent as ReactMouseEvent, type ReactNode, memo, useMemo, useState } from 'react';
import type { Channel, TimelineItem, TimelineLane } from '../../api/types';
import { spellIcon } from '../../icons';
import { formatEventTime, formatInteger, formatScaled } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import type { FilterTab } from '../../scopeSides';
import type { TimeRange } from '../../store';
import { GameIcon, MonogramTile } from '../GameIcon';
import { rowValue, valueLabel } from '../filters/labels';
import { PlayerIcon } from '../reports/PlayerName';
import type { rosterIndex } from '../reports/reportData';
import { PowerLane } from './PowerLane';
import type { ViewNames } from './viewNames';
import { percentIn } from './zoomGeometry';

const ICON_PX = 22;
/** The height of `.tl-track`; stacked icons stay inside it. */
const LANE_PX = 36;
const ICON_TOP_PX = 6;
/** Overlapping icons stack this many px apart, at most this deep. */
const STACK_PX = 4;
const STACK_DEPTH = 2;
const BARS: TimelineItem['kind'][] = ['castTime', 'empowered', 'noOutcome', 'interrupted', 'aura'];
const COUNTED: FilterTab[] = ['casts', 'interrupts', 'deaths'];
const AMOUNTS: FilterTab[] = ['damage', 'healing', 'taken'];
const SHOWN_TRACKS = 8;
const TRACK_PX = 14;
export const DEBUFF_COLOURS = ['var(--target-1)', 'var(--target-2)', 'var(--target-3)', 'var(--target-4)', 'var(--role-healer)', 'var(--pull-a)', 'var(--pull-b)', 'var(--lust)'];

export type MarkHandler = (item: TimelineItem, context: boolean, event: ReactMouseEvent<HTMLElement>) => void;

interface MarksProps {
  items: TimelineItem[];
  shown: TimeRange;
  names: ViewNames;
  widthPx: number;
  context: boolean;
  /** Sub-tracks the lane shows; aura bars sit on their own. */
  tracks?: number;
  /** Damage Taken's debuff names in order of appearance; a debuff takes the colour of its name's place. */
  legend: string[] | null;
  onEnter: MarkHandler;
  onLeave: () => void;
  onPin: MarkHandler;
}

const isBar = (item: TimelineItem) => BARS.includes(item.kind) && item.endMs !== undefined && item.endMs > item.startMs;
const markIcon = (item: TimelineItem) => (item.kind === 'interrupt' || item.kind === 'dispel' || item.kind === 'steal' ? (item.used ?? item.spellId) : item.spellId);

function isVisible(item: TimelineItem, shown: TimeRange): boolean {
  const from = percentIn(item.startMs, shown);
  const to = percentIn(item.spanEndMs, shown);
  if (isBar(item) || item.channel !== undefined) return to >= 0 && from <= 100;
  if (item.kind === 'death') return to >= 0 && to <= 100;
  return from >= 0 && from <= 100;
}

function barColour(item: TimelineItem, names: ViewNames, legend: string[] | null): string | undefined {
  if (item.kind === 'aura' && legend) {
    const place = legend.indexOf(names.spell(item.spellId));
    return place < 0 ? undefined : DEBUFF_COLOURS[place % DEBUFF_COLOURS.length];
  }
  return names.colour(item.source);
}

const castPaint = (colour: string | undefined) => (colour ? ({ '--cast': colour } as CSSProperties) : undefined);

function Marks({ items, shown, names, widthPx, context, tracks = 1, legend, onEnter, onLeave, onPin }: MarksProps) {
  const stacked = tracks > 1;
  let lastPx = -Infinity;
  let level = 0;
  return items.map((item, i) => {
    if (!isVisible(item, shown)) return null;
    const handlers = {
      onMouseEnter: (event: ReactMouseEvent<HTMLElement>) => onEnter(item, context, event),
      onMouseLeave: onLeave,
      onClick: (event: ReactMouseEvent<HTMLElement>) => onPin(item, context, event),
    };
    const key = `${item.kind}-${item.startMs}-${item.source}-${item.spellId}-${i}`;
    const from = percentIn(item.startMs, shown);
    if (item.kind === 'death') {
      const at = percentIn(item.endMs ?? item.startMs, shown);
      const band = item.endMs !== undefined ? Math.max(0, from) : at;
      const label = t('tl.deathLabel', { name: names.unit(item.target) || t('scope.unknownUnit'), time: formatEventTime(item.endMs ?? item.startMs) });
      return (
        <span key={key} className="tl-death-wrap">
          {band < at && <span className="tl-band" style={{ left: `${band}%`, width: `${at - band}%` }} />}
          <button type="button" className="tl-death" style={{ left: `${at}%` }} aria-label={label} {...handlers} />
        </span>
      );
    }
    const spell = names.spell(item.spellId);
    const label = t('tl.markLabel', { spell, time: formatEventTime(item.startMs), name: names.unit(item.source) || t('scope.environment') });
    const { channel } = item;
    if (isBar(item) || channel) {
      const left = Math.max(0, from);
      const to = Math.min(100, percentIn(item.spanEndMs, shown));
      const place = stacked ? { top: 4 + (item.track ?? 0) * TRACK_PX, height: TRACK_PX - 2 } : {};
      const icon = <GameIcon icon={spellIcon(item.spellId)} size={stacked ? 12 : 16} name={spell} />;
      const paint = castPaint(context ? undefined : names.colour(item.source));
      const bar = (
        <button
          key={key}
          type="button"
          className={`tl-bar ${item.kind}${context ? ' boss' : ''}${stacked ? ' thin' : ''}`}
          style={{ left: `${left}%`, width: `${to - left}%`, background: channel || context ? undefined : barColour(item, names, legend), ...paint, ...place }}
          aria-label={label}
          {...handlers}
        >
          {channel ? (
            <ChannelFill channel={channel} left={left} to={to} shown={shown}>
              {icon}
            </ChannelFill>
          ) : (
            icon
          )}
        </button>
      );
      if (!channel) return bar;
      return (
        <Fragment key={key}>
          {bar}
          {channel.ticks.map((tick) => (
            <span key={tick} className="tl-notch" data-testid="channel-tick" style={{ left: `${percentIn(tick, shown)}%` }} />
          ))}
        </Fragment>
      );
    }
    if (item.kind === 'rejected') {
      return <button key={key} type="button" className="tl-dot" style={{ left: `${from}%` }} aria-label={label} {...handlers} />;
    }
    const px = (from / 100) * widthPx;
    level = px - lastPx < ICON_PX ? Math.min(STACK_DEPTH, level + 1) : 0;
    lastPx = px;
    const top = Math.min(ICON_TOP_PX + level * STACK_PX, LANE_PX - ICON_PX);
    const size = item.kind === 'hit' ? 16 : ICON_PX;
    return (
      <button key={key} type="button" className={`tl-icon ${item.kind}`} style={{ left: `${from}%`, top }} aria-label={label} {...handlers}>
        <GameIcon icon={spellIcon(markIcon(item))} size={size} name={spell} />
      </button>
    );
  });
}

/** The solid part to the last tick, which holds the icon, and the tail held after it. */
function ChannelFill({ channel, left, to, shown, children }: { channel: Channel; left: number; to: number; shown: TimeRange; children: ReactNode }) {
  const width = to - left;
  const lastTick = channel.lastTickMs;
  const solid = width > 0 && lastTick !== undefined ? Math.min(100, Math.max(0, ((percentIn(lastTick, shown) - left) / width) * 100)) : 100;
  return (
    <>
      <span className="tl-fill" style={{ width: `${solid}%` }}>
        {children}
      </span>
      {channel.endMs !== undefined && lastTick !== undefined && channel.endMs > lastTick && <span className="tl-tail" data-testid="channel-tail" style={{ left: `${solid}%` }} />}
    </>
  );
}

interface LabelProps {
  tab: FilterTab;
  lane: TimelineLane;
  label?: string;
  names: ViewNames;
  roster: ReturnType<typeof rosterIndex>;
  more: ReactNode;
}

function LaneLabel({ tab, lane, label: shownLabel, names, roster, more }: LabelProps) {
  const count = COUNTED.includes(tab) ? formatInteger(lane.total) : AMOUNTS.includes(tab) ? formatScaled(lane.total) : '';
  if (lane.key === null) {
    return (
      <span className="tl-label">
        <span className="nm">{t('tl.oneLane')}</span>
        {more}
        <span className="num tl-count">{count}</span>
      </span>
    );
  }
  const value = rowValue(lane.key);
  const label = valueLabel(value, lane.name, lane.number, lane.key.kind === 'ability' ? lane.key.rowKind : 'own');
  const player = value.kind === 'player' ? roster.get(value.actorId) : undefined;
  let icon: ReactNode;
  if (lane.key.kind === 'ability') icon = <GameIcon icon={spellIcon(lane.spellId)} size={18} name={label} />;
  else if (player) icon = <PlayerIcon player={player} size={18} />;
  else icon = <MonogramTile name={label} size={18} />;
  return (
    <span className="tl-label" title={label}>
      {icon}
      <span className="nm" style={{ color: player ? names.colour(player.actorId) : undefined }}>
        {shownLabel ?? label}
      </span>
      {more}
      <span className="num tl-count">{count}</span>
    </span>
  );
}

export type RowProps = Omit<MarksProps, 'items' | 'context' | 'tracks'>;

/** The first sub-tracks of a lane and the items on them, with a toggle that opens the rest. */
function useShownTracks(items: TimelineItem[], tracks: number) {
  const [open, setOpen] = useState(false);
  const shownItems = useMemo(() => (open ? items : items.filter((item) => (item.track ?? 0) < SHOWN_TRACKS)), [open, items]);
  const hidden = tracks - SHOWN_TRACKS;
  const more = hidden > 0 && (
    <button type="button" className="tl-more" aria-expanded={open} aria-label={t(open ? 'tl.fewer' : 'tl.more', { count: hidden })} onClick={() => setOpen((current) => !current)}>
      {open ? '−' : `+${hidden}`}
    </button>
  );
  return { items: shownItems, tracks: open ? tracks : Math.min(tracks, SHOWN_TRACKS), more };
}

const trackHeight = (tracks: number) => (tracks > 1 ? { height: 8 + tracks * TRACK_PX } : undefined);

export const laneKey = (lane: TimelineLane) => (lane.key === null ? 'one' : JSON.stringify(lane.key));

/** One lane of the lane dimension; it draws again only when its marks, the window or the names change. */
export const LaneRow = memo(function LaneRow(props: RowProps & { tab: FilterTab; lane: TimelineLane; label?: string; roster: ReturnType<typeof rosterIndex> }) {
  const { tab, lane, label, roster, ...marks } = props;
  const { items, tracks, more } = useShownTracks(lane.items, lane.tracks);
  const unit = lane.key?.kind === 'unit' ? lane.key.unit : null;
  return (
    <div className="tl-lane">
      <LaneLabel tab={tab} lane={lane} label={label} names={marks.names} roster={roster} more={more} />
      {tab === 'resources' ? (
        <div className="tl-track tl-track-power">
          <PowerLane lane={lane} shown={marks.shown} player={unit?.kind === 'player' ? roster.get(unit.actorId) : undefined} />
        </div>
      ) : (
        <div className="tl-track" style={trackHeight(tracks)}>
          <Marks items={items} context={false} tracks={tracks} {...marks} />
        </div>
      )}
    </div>
  );
});

/** The encounter's casts above the lanes. */
export const ContextRow = memo(function ContextRow(props: RowProps & { items: TimelineItem[] }) {
  const { items, ...marks } = props;
  return (
    <div className="tl-lane tl-context">
      <span className="tl-label">
        <span className="cap">{t('tl.context')}</span>
      </span>
      <div className="tl-track">
        <Marks items={items} context {...marks} />
      </div>
    </div>
  );
});
