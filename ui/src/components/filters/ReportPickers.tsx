import { type FilterTab, SIDES } from '../../scopeSides';
import { useApp } from '../../store';
import { FilterPicker } from './FilterPicker';
import { allLabel, captionOf, holdsFriendlies } from './sides';

/** The report panel head's other-side and ability pickers. */
export function ReportPickers({ tab }: { tab: FilterTab }) {
  const scope = useApp((s) => s.scope);
  const other = SIDES[tab].other;
  return (
    <>
      {other && (
        <FilterPicker
          dimension={other}
          caption={captionOf(tab, other)}
          allLabel={allLabel(tab, other, scope.perspective)}
          value={scope[other][0] ?? null}
          playersByRole={holdsFriendlies(tab, other, scope.perspective)}
        />
      )}
      <FilterPicker
        dimension="ability"
        caption={captionOf(tab, 'ability')}
        allLabel={allLabel(tab, 'ability', scope.perspective)}
        value={scope.ability[0] ?? null}
      />
    </>
  );
}
