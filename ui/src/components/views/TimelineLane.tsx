import { type MouseEvent as ReactMouseEvent, type ReactNode, memo, useMemo, useState } from 'react';
import type { TimelineItem, TimelineLane } from '../../api/types';
import { spellIcon } from '../../icons';
import { formatEventTime, formatInteger, formatScaled } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import type { FilterTab } from '../../scopeSides';
import type { TimeRange } from '../../store';
import { GameIcon, MonogramTile } from '../GameIcon';
import { rowValue, valueLabel } from '../filters/labels';
import { PlayerIcon } from '../reports/PlayerName';
import type { rosterIndex } from '../reports/reportData';
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
  /** Sub-tracks the lane shows; bars sit on their own. */
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
  const to = percentIn(item.endMs ?? item.startMs, shown);
  if (isBar(item)) return to >= 0 && from <= 100;
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

function Marks({ items, shown, names, widthPx, context, tracks = 1, legend, onEnter, onLeave, onPin }: MarksProps) {
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
    if (isBar(item)) {
      const left = Math.max(0, from);
      const to = Math.min(100, percentIn(item.endMs ?? item.startMs, shown));
      const stacked = tracks > 1;
      const place = stacked ? { top: 4 + (item.track ?? 0) * TRACK_PX, height: TRACK_PX - 2 } : {};
      return (
        <button
          key={key}
          type="button"
          className={`tl-bar ${item.kind}${context ? ' boss' : ''}${stacked ? ' thin' : ''}`}
          style={{ left: `${left}%`, width: `${to - left}%`, background: context ? undefined : barColour(item, names, legend), ...place }}
          aria-label={label}
          {...handlers}
        >
          <GameIcon icon={spellIcon(item.spellId)} size={stacked ? 12 : 16} name={spell} />
          <span className="tl-bar-name">{spell}</span>
        </button>
      );
    }
    if (item.kind === 'rejected') return <button key={key} type="button" className="tl-dot" style={{ left: `${from}%` }} aria-label={label} {...handlers} />;
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

interface LabelProps {
  tab: FilterTab;
  lane: TimelineLane;
  names: ViewNames;
  roster: ReturnType<typeof rosterIndex>;
  hidden: number;
  open: boolean;
  onToggle: () => void;
}

function LaneLabel({ tab, lane, names, roster, hidden, open, onToggle }: LabelProps) {
  const more = hidden > 0 && (
    <button type="button" className="tl-more" aria-expanded={open} aria-label={t(open ? 'tl.fewer' : 'tl.more', { count: hidden })} onClick={onToggle}>
      {open ? '−' : `+${hidden}`}
    </button>
  );
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
        {label}
      </span>
      {more}
      <span className="num tl-count">{count}</span>
    </span>
  );
}

type RowProps = Omit<MarksProps, 'items' | 'context' | 'tracks'>;

/** One lane of the lane dimension; it draws again only when its marks, the window or the names change. */
export const LaneRow = memo(function LaneRow(props: RowProps & { tab: FilterTab; lane: TimelineLane; roster: ReturnType<typeof rosterIndex> }) {
  const { tab, lane, roster, ...marks } = props;
  const [open, setOpen] = useState(false);
  const tracks = open ? lane.tracks : Math.min(lane.tracks, SHOWN_TRACKS);
  const items = useMemo(() => (open ? lane.items : lane.items.filter((item) => (item.track ?? 0) < SHOWN_TRACKS)), [open, lane.items]);
  return (
    <div className="tl-lane">
      <LaneLabel tab={tab} lane={lane} names={marks.names} roster={roster} hidden={lane.tracks - SHOWN_TRACKS} open={open} onToggle={() => setOpen((current) => !current)} />
      <div className="tl-track" style={tracks > 1 ? { height: 8 + tracks * TRACK_PX } : undefined}>
        <Marks items={items} context={false} tracks={tracks} {...marks} />
      </div>
    </div>
  );
});

/** The encounter's casts above the lanes. */
export const ContextRow = memo(function ContextRow(props: RowProps & { items: TimelineItem[] }) {
  return (
    <div className="tl-lane tl-context">
      <span className="tl-label">
        <span className="cap">{t('tl.context')}</span>
      </span>
      <div className="tl-track">
        <Marks context {...props} />
      </div>
    </div>
  );
});
