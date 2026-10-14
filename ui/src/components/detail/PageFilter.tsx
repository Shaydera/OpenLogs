import { useEffect, useMemo, useState } from 'react';
import type { Dimension, FilterOption, PlayerRef } from '../../api/types';
import { t } from '../../i18n/i18n';
import { pageScope, useApp, viewDimension } from '../../store';
import type { ScopeValue } from '../filters/labels';
import { selectionLabel } from '../filters/pickerModel';
import { playerIndex } from '../overview/players';

const CAPTION = { source: 'scope.source', target: 'scope.target', ability: 'scope.ability' } as const;

interface Props {
  dimensions: Dimension[];
  /** Opens the selected ability's page; only a player page has one. */
  onOpenAbility?: () => void;
}

/** "Filtered: Target Ula'tek · Ability Execute ×": the page filter's selections this page applies. */
export function PageFilter({ dimensions, onOpenAbility }: Props) {
  const filters = useApp((s) => s.filters);
  const tab = useApp((s) => s.tab);
  const clearPageFilter = useApp((s) => s.clearPageFilter);
  const scope = pageScope(filters, tab === 'healing' ? 'healing' : 'damage');
  const shown = dimensions.filter((d) => scope[d].length > 0);
  if (shown.length === 0) return null;
  return (
    <p className="page-filter">
      <span className="cap">{t('detail.filtered')}</span>
      {shown.map((d, i) => (
        <span key={d}>
          {i > 0 && ' · '}
          <Selection dimension={d} value={scope[d][0]} onOpenAbility={onOpenAbility} />
        </span>
      ))}
      <button type="button" className="dd-clear" aria-label={t('breakdown.clear')} onClick={() => void clearPageFilter(shown)}>
        ×
      </button>
    </p>
  );
}

function Selection({ dimension, value, onOpenAbility }: { dimension: Dimension; value: ScopeValue; onOpenAbility?: () => void }) {
  const perspective = useApp((s) => s.filters.perspective);
  const healing = useApp((s) => s.tab === 'healing');
  const overview = useApp((s) => s.overview);
  const loadOptions = useApp((s) => s.filterOptions);
  const openPlayer = useApp((s) => s.openPlayer);
  const openTarget = useApp((s) => s.openTarget);
  const [options, setOptions] = useState<FilterOption[]>([]);
  const roster = useMemo(() => (overview ? playerIndex(overview) : new Map<number, PlayerRef>()), [overview]);

  useEffect(() => {
    let live = true;
    void loadOptions(viewDimension(dimension, perspective)).then((list) => live && setOptions(list));
    return () => {
      live = false;
    };
  }, [dimension, value, perspective, loadOptions]);

  const label = selectionLabel(value, options, roster);
  // Target pages list enemies of Damage Done; a healed unit has none.
  const openEnemy = (name: string | undefined) => (healing || name === undefined ? undefined : () => void openTarget(name));
  const open = (() => {
    switch (value.kind) {
      case 'player':
        return () => void openPlayer(value.actorId);
      case 'unit':
        return openEnemy(value.name);
      case 'instance':
        return openEnemy(options.find((o) => o.instances.some((i) => i.actorId === value.actorId))?.name);
      case 'name':
      case 'id':
        return onOpenAbility;
      default:
        return undefined;
    }
  })();
  return (
    <>
      {t(CAPTION[dimension])}{' '}
      {open ? (
        <button type="button" className="page-filter-link" onClick={open}>
          {label}
        </button>
      ) : (
        <strong>{label}</strong>
      )}
    </>
  );
}
