import { useId, useRef, useState } from 'react';
import type { Dimension } from '../../api/types';
import { useDismiss } from '../../hooks/useDismiss';
import { t } from '../../i18n/i18n';
import { type MetricTab, useApp } from '../../store';

const ORDER: Record<MetricTab, Dimension[]> = {
  damage: ['source', 'ability', 'target'],
  healing: ['source', 'ability', 'target'],
  taken: ['target', 'ability', 'source'],
};
const VERB = { damage: 'done', healing: 'healing', taken: 'taken' } as const satisfies Record<MetricTab, string>;

const rowsLabel = (tab: MetricTab, dimension: Dimension) => t(`rows.${VERB[tab]}.${dimension}`);

export function RowsMenu({ tab, group }: { tab: MetricTab; group: Dimension }) {
  const scope = useApp((s) => s.scope);
  const setGrouping = useApp((s) => s.setGrouping);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useDismiss(root, open, {
    onDismiss: () => setOpen(false),
    onEscape: () => {
      setOpen(false);
      button.current?.focus();
    },
  });

  return (
    <div ref={root} className="options">
      <button ref={button} type="button" className="dd" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>
        <span className="dd-caption">{t('rows.caption')}</span>
        <span>{rowsLabel(tab, group)}</span>
      </button>
      {open && (
        <div id={id} className="options-pop rows-pop" role="dialog" aria-label={t('rows.caption')}>
          {ORDER[tab].map((d) => {
            const narrowed = scope[d].length > 0;
            return (
              <button
                key={d}
                type="button"
                className={d === group ? 'opt on' : 'opt'}
                aria-pressed={d === group}
                disabled={narrowed}
                onClick={() => {
                  setOpen(false);
                  void setGrouping(d);
                }}
              >
                {rowsLabel(tab, d)}
                {narrowed && <span className="options-hint">{t('rows.filtered')}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
