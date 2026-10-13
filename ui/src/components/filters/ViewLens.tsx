import { t } from '../../i18n/i18n';
import { ownDimension } from '../../scopeSides';
import { isMetricTab, useApp } from '../../store';
import { FilterPicker } from './FilterPicker';
import { allLabel, captionOf, holdsFriendlies } from './sides';

export function ViewLens() {
  const tab = useApp((s) => s.tab);
  const details = useApp((s) => s.details);
  const scope = useApp((s) => s.scope);
  const setPerspective = useApp((s) => s.setPerspective);
  if (!isMetricTab(tab) || details.length > 0) return null;
  const own = ownDimension(tab);
  return (
    <div className="panel lens" role="group" aria-label={t('scope.lens')}>
      <span className="cap">{t('scope.viewAs')}</span>
      <div className="seg" role="group" aria-label={t('scope.perspective')}>
        {(['friendly', 'enemy'] as const).map((side) => (
          <button
            key={side}
            type="button"
            className={scope.perspective === side ? 'on' : undefined}
            aria-pressed={scope.perspective === side}
            onClick={() => void setPerspective(side)}
          >
            {t(side === 'friendly' ? 'scope.friendlies' : 'scope.enemies')}
          </button>
        ))}
      </div>
      <FilterPicker
        large
        dimension={own}
        caption={captionOf(tab, own)}
        allLabel={allLabel(tab, own, scope.perspective)}
        value={scope[own][0] ?? null}
        playersByRole={holdsFriendlies(tab, own, scope.perspective)}
      />
    </div>
  );
}
