import { Fragment, useMemo, useState } from 'react';
import type { TimelineLane, UnitRef } from '../../api/types';
import { useApp } from '../../store';
import { rowValue, sameValue, valueLabel } from '../filters/labels';
import type { rosterIndex } from '../reports/reportData';
import { GroupToggle } from '../resources/GroupToggle';
import { type UnitFacts, memberLabel, nameGroups, orderUnits } from '../resources/unitOrder';
import { LaneRow, type RowProps, laneKey } from './TimelineLane';

const unitOf = (lane: TimelineLane) => (lane.key?.kind === 'unit' ? lane.key.unit : null);
const laneLabel = (lane: TimelineLane, number = lane.number) => (lane.key === null ? '' : valueLabel(rowValue(lane.key), lane.name, number));

/** Whether the lens picks the group's name or one of its members. */
function picked(source: UnitRef[], members: TimelineLane[]): boolean {
  return source.some(
    (value) =>
      (value.kind === 'unit' && value.name === members[0].name) ||
      members.some((member) => {
        const unit = unitOf(member);
        return unit !== null && sameValue(unit, value);
      }),
  );
}

/** The Resources lanes in the table's order, the units of a shared name in a group that opens. */
export function ResourceLanes({ lanes, roster, row }: { lanes: TimelineLane[]; roster: ReturnType<typeof rosterIndex>; row: RowProps }) {
  const source = useApp((s) => s.scope.source);
  const [chosen, setChosen] = useState<ReadonlyMap<string, boolean>>(new Map());
  const { ordered, groups } = useMemo(() => {
    const facts = (lane: TimelineLane): UnitFacts => {
      const unit = unitOf(lane);
      return {
        boss: lane.boss,
        player: unit?.kind === 'player',
        role: (unit?.kind === 'player' ? roster.get(unit.actorId)?.role : null) ?? null,
        label: laneLabel(lane),
        name: lane.name,
      };
    };
    const ordered = orderUnits(lanes, facts);
    return { ordered, groups: nameGroups(ordered, facts) };
  }, [lanes, roster]);
  return ordered.map((lane) => {
    const members = groups.get(lane);
    if (!members) return <LaneRow key={laneKey(lane)} tab="resources" lane={lane} roster={roster} {...row} />;
    if (members[0] !== lane) return null;
    const open = chosen.get(lane.name) ?? picked(source, members);
    return (
      <Fragment key={`group-${lane.name}`}>
        <div className="tl-lane tl-group">
          <span className="tl-label">
            <GroupToggle
              name={laneLabel(lane, null)}
              count={members.length}
              open={open}
              className="tl-group-toggle"
              onToggle={() => setChosen((current) => new Map(current).set(lane.name, !open))}
            />
          </span>
          <div className="tl-track" />
        </div>
        {open &&
          members.map((member) => (
            <LaneRow key={laneKey(member)} tab="resources" lane={member} label={memberLabel(member.number)} roster={roster} {...row} />
          ))}
      </Fragment>
    );
  });
}
