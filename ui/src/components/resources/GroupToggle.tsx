import { t } from '../../i18n/i18n';

/** The row of a group of units of one name: opens and closes the group. */
export function GroupToggle({ name, count, open, current = false, className, onToggle }: { name: string; count: number; open: boolean; current?: boolean; className: string; onToggle: () => void }) {
  return (
    <button type="button" className={className} aria-expanded={open} aria-current={current ? 'true' : undefined} onClick={onToggle}>
      <span className="plink-arrow" aria-hidden="true">
        {open ? '▾' : '▸'}
      </span>
      <span className="plink-group-title">
        <span className="plink-name">{name}</span>
        {' '}
        <span className="plink-count">{t('resources.groupCount', { count })}</span>
      </span>
    </button>
  );
}
