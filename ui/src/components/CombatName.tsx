import { t } from '../i18n/i18n';

/** A combat pull's name and a `+N` tag for the further enemies, which assistive tech hears as "and N more enemies". */
export function CombatName({ name, more }: { name: string; more: number }) {
  return (
    <>
      <span className="combat-name">{name}</span>
      {more > 0 && (
        <>
          <span className="num more-tag" aria-hidden="true" title={t('combat.moreTitle', { count: more })}>
            {t('combat.more', { count: more })}
          </span>
          <span className="sr-only"> {t('combat.moreEnemies', { count: more })}</span>
        </>
      )}
    </>
  );
}
