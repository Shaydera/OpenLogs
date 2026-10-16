import type { PlayerRef, ReplayData, ReplayUnitKind } from '../../api/types';
import { t } from '../../i18n/i18n';
import { type ReplayFilters, useApp } from '../../store';
import { classColor, shortName } from '../overview/players';

interface LegendEntry {
  key: string;
  label: string;
  kind: ReplayUnitKind;
  /** Bosses and adds of one name, and one owner's pets of one name, share an entry. */
  actors: number[];
  /** Class colour of a player or a pet's owner. */
  color: string | null;
}

const KIND_ORDER: ReplayUnitKind[] = ['player', 'pet', 'boss', 'add'];
const ROLE_ORDER = ['tank', 'healer', 'damage'];
const KIND_FILTER: Record<ReplayUnitKind, keyof Omit<ReplayFilters, 'hidden'>> = { player: 'players', pet: 'pets', boss: 'bosses', add: 'adds' };

const roleRank = (player: PlayerRef | undefined) => {
  const rank = player?.role ? ROLE_ORDER.indexOf(player.role) : -1;
  return rank < 0 ? ROLE_ORDER.length : rank;
};

/** The legend's entries for the unit kinds `filters` shows: players by role and name, then pets, bosses and adds by name. */
function legendEntries(data: ReplayData, filters: ReplayFilters): LegendEntry[] {
  const roster = new Map(data.roster.map((player) => [player.actorId, player]));
  const players = data.units
    .filter((unit) => unit.kind === 'player')
    .map((unit) => ({ unit, player: roster.get(unit.actor), label: shortName(unit.name) }))
    .sort((a, b) => roleRank(a.player) - roleRank(b.player) || a.label.localeCompare(b.label))
    .map(({ unit, player, label }): LegendEntry => ({ key: `player-${unit.actor}`, label, kind: 'player', actors: [unit.actor], color: classColor(player?.classToken ?? null) }));
  const groups = new Map<string, LegendEntry>();
  for (const unit of data.units) {
    if (unit.kind === 'player') continue;
    const key = `${unit.kind}-${unit.owner ?? ''}-${unit.name}`;
    const owner = unit.owner === null ? undefined : roster.get(unit.owner);
    const entry = groups.get(key) ?? { key, label: unit.name, kind: unit.kind, actors: [], color: owner ? classColor(owner.classToken) : null };
    entry.actors.push(unit.actor);
    groups.set(key, entry);
  }
  const others = [...groups.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.label.localeCompare(b.label));
  return [...players, ...others].filter((entry) => filters[KIND_FILTER[entry.kind]]);
}

/** The units above the stage: a click hides or shows them, hovering or focusing one highlights it. */
export function ReplayLegend({ data, highlight, onHighlight }: { data: ReplayData; highlight: number[] | null; onHighlight: (actors: number[] | null) => void }) {
  const filters = useApp((s) => s.replay.filters);
  const setReplayFilter = useApp((s) => s.setReplayFilter);
  const hidden = new Set(filters.hidden);

  function toggle(entry: LegendEntry) {
    const shown = entry.actors.some((actor) => !hidden.has(actor));
    const rest = filters.hidden.filter((actor) => !entry.actors.includes(actor));
    setReplayFilter({ hidden: shown ? [...rest, ...entry.actors] : rest });
  }

  return (
    <div className="replay-legend" role="group" aria-label={t('replay.legend')}>
      {legendEntries(data, filters).map((entry) => {
        const shown = entry.actors.some((actor) => !hidden.has(actor));
        const dimmed = highlight !== null && !entry.actors.some((actor) => highlight.includes(actor));
        const classes = ['replay-legend-entry', `replay-legend-${entry.kind}`, shown ? '' : 'off', dimmed ? 'dim' : ''].filter(Boolean).join(' ');
        return (
          <button
            key={entry.key}
            type="button"
            className={classes}
            style={entry.color ? { color: entry.color } : undefined}
            aria-pressed={shown}
            onClick={() => toggle(entry)}
            onPointerEnter={() => onHighlight(entry.actors)}
            onPointerLeave={() => onHighlight(null)}
            onFocus={() => onHighlight(entry.actors)}
            onBlur={() => onHighlight(null)}
          >
            <span className="replay-legend-dot" aria-hidden="true" />
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}
