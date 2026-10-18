import { t } from '../../i18n/i18n';
import { isFilterTab, SIDES } from '../../scopeSides';
import { useApp } from '../../store';
import { FilterPicker } from './FilterPicker';
import { allLabel, captionOf, holdsFriendlies } from './sides';

export function ViewLens() {
  const tab = useApp((s) => s.tab);
  const details = useApp((s) => s.details);
  const scope = useApp((s) => s.scope);
  const setPerspective = useApp((s) => s.setPerspective);
  const overview = tab === 'overview';
  if ((!overview && !isFilterTab(tab)) || details.length > 0) return null;
  const own = isFilterTab(tab) ? SIDES[tab].own : null;
  const shown = overview ? 'friendly' : scope.perspective;
  return (
    <div className="lens" role="group" aria-label={t('scope.lens')}>
      <span className="cap">{t('scope.viewAs')}</span>
      <div className="seg" role="group" aria-label={t('scope.perspective')} title={overview ? t('scope.overviewFriendlies') : undefined}>
        {(['friendly', 'enemy'] as const).map((side) => (
          <button
            key={side}
            type="button"
            className={shown === side ? 'on' : undefined}
            aria-pressed={shown === side}
            disabled={overview}
            onClick={() => void setPerspective(side)}
          >
            {t(side === 'friendly' ? 'scope.friendlies' : 'scope.enemies')}
          </button>
        ))}
      </div>
      {isFilterTab(tab) && own && (
        <FilterPicker
          large
          dimension={own}
          caption={captionOf(tab, own)}
          allLabel={allLabel(tab, own, scope.perspective)}
          value={scope[own][0] ?? null}
          playersByRole={holdsFriendlies(tab, own, scope.perspective)}
        />
      )}
    </div>
  );
}
