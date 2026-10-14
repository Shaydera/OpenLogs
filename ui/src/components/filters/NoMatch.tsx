import { t } from '../../i18n/i18n';
import { useApp } from '../../store';

/** An empty table: under a selection it says so and offers to clear it; otherwise `nothing`. */
export function NoMatch({ nothing }: { nothing: string }) {
  const scope = useApp((s) => s.scope);
  const clearFilters = useApp((s) => s.clearFilters);
  const filtered = scope.source.length + scope.target.length + scope.ability.length > 0;
  return (
    <div className="report-empty">
      <p className="muted">{filtered ? t('breakdown.empty') : nothing}</p>
      {filtered && (
        <button type="button" className="btn" onClick={() => void clearFilters()}>
          {t('breakdown.clear')}
        </button>
      )}
    </div>
  );
}
