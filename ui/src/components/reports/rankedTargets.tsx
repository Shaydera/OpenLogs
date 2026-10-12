import { type ReactNode, useState } from 'react';
import type { AbilityRow, GroupAbilities, PlayerRef, TargetRef, TargetShare } from '../../api/types';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { shortName } from '../overview/players';
import { AugTip } from './AugTip';
import type { TipLine } from './augSplit';
import { abilityBreakdown } from './breakdown';
import { rosterIndex, type SpellNames } from './reportData';
import { CARD_WIDTH, PlayerCard, SegmentPopup, StackedFill, TOP_TARGETS, targetRows, usePanelPopup } from './TargetParts';
import { type GroupPart, type TargetMetric, enemyGroupKey, splitByGroup, targetColors } from './targetGroups';

export interface RankedPopup {
  kind: 'player' | 'segment' | 'aug';
  player: number;
  part?: GroupPart;
}

/** What Damage Done and Healing rank: a player with rows and targets. */
export interface RankedPlayer {
  player: number;
  total: number;
  abilities: AbilityRow[];
  targets: TargetShare[];
  /** Damage only: the largest abilities on each colour group. */
  groupAbilities?: GroupAbilities[];
}

interface RankedReport<P> {
  players: P[];
  spells: SpellNames;
  roster: PlayerRef[];
}

/**
 * The target split of a ranked report: colour groups, the bar fills, and the popups by location — name
 * (player card), bar segment (that target group), dotted total (the Aug split).
 */
export function useRankedTargets<P extends RankedPlayer>(report: RankedReport<P>, metric: TargetMetric, colorGroups: string[]) {
  const colorByTarget = useApp((s) => s.colorByTarget);
  const [chosen, setHighlight] = useState<string | null>(null);
  const roster = rosterIndex(report.roster);
  const { groups, keyOf, colorOf } = targetColors(metric, colorGroups, roster);
  const highlight = groups.some((group) => group.key === chosen) ? chosen : null;
  const { panel, popup, open, close } = usePanelPopup<RankedPopup>(report);
  const rowOf = (element: HTMLElement) => element.closest<HTMLElement>('.rrow');

  const fill = (p: P, widthPct: number): ReactNode =>
    colorByTarget ? (
      <StackedFill
        parts={splitByGroup(p.targets, groups, keyOf)}
        total={p.total}
        widthPct={widthPct}
        highlight={highlight}
        onSegment={(part, segment) => (segment ? open({ kind: 'segment', player: p.player, part }, segment, rowOf(segment)) : close())}
      />
    ) : undefined;
  const preview = (p: P) => (name: HTMLElement | null, row: HTMLElement | null) => (name ? open({ kind: 'player', player: p.player }, name, row, CARD_WIDTH) : close());
  /** The total, dotted and explaining its Aug split on hover when it has one. */
  const total = (p: P, text: string, hasAug: boolean): ReactNode =>
    hasAug ? (
      <span
        className="num dotted"
        onMouseEnter={(event) => open({ kind: 'aug', player: p.player }, event.currentTarget, rowOf(event.currentTarget))}
        onMouseLeave={close}
      >
        {text}
      </span>
    ) : (
      <span className="num">{text}</span>
    );
  return {
    panel,
    popup,
    roster,
    groups,
    colorOf,
    colorByTarget,
    highlight,
    toggleHighlight: (key: string) => setHighlight(highlight === key ? null : key),
    fill,
    preview,
    total,
  };
}

/** The open popup of a ranked report. */
export function RankedPopupView<P extends RankedPlayer>({
  id,
  popup,
  report,
  metric,
  roster,
  colorOf,
  augLines,
}: {
  id: string;
  popup: { data: RankedPopup; at: { top: number; left: number } } | null;
  report: RankedReport<P>;
  metric: TargetMetric;
  roster: Map<number, PlayerRef>;
  colorOf: (target: TargetRef) => string;
  augLines: (p: P) => TipLine[];
}) {
  const p = popup ? report.players.find((x) => x.player === popup.data.player) : undefined;
  if (!popup || !p) return null;
  const player = roster.get(p.player);
  if (popup.data.kind === 'aug') return <AugTip id={id} player={player} lines={augLines(p)} top={popup.at.top} left={popup.at.left} />;
  if (popup.data.kind === 'segment' && popup.data.part) {
    const key = popup.data.part.group.key;
    return (
      <SegmentPopup
        id={id}
        at={popup.at}
        part={popup.data.part}
        ofName={player ? shortName(player.name) : t('report.unknownPlayer')}
        total={p.total}
        metric={metric}
        spells={report.spells}
        roster={roster}
        abilities={p.groupAbilities?.find((group) => enemyGroupKey(group.group) === key)?.abilities}
      />
    );
  }
  return (
    <PlayerCard
      id={id}
      at={popup.at}
      player={player}
      total={p.total}
      abilities={abilityBreakdown(p.abilities, { total: p.total, spells: report.spells, roster })}
      targets={targetRows(p.targets, { total: p.total, roster, colorOf, top: TOP_TARGETS })}
      targetsLabel={t(metric === 'healing' ? 'targets.healedPlayers' : 'targets.title')}
    />
  );
}
