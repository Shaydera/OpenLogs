import { useId, useRef, useState } from 'react';
import type { Dimension } from '../../api/types';
import { useDismiss } from '../../hooks/useDismiss';
import { type MessageKey, t } from '../../i18n/i18n';
import { type FilterTab, SIDES } from '../../scopeSides';
import { useApp } from '../../store';

const VERB = { damage: 'done', healing: 'healing', taken: 'taken', casts: 'casts', interrupts: 'kicks', buffs: 'auras' } as const satisfies Partial<Record<FilterTab, string>>;

const rowsLabel = (tab: FilterTab, dimension: Dimension) => t(`rows.${VERB[tab as keyof typeof VERB]}.${dimension}` as MessageKey);

/** The tab's row groupings; a tab with one grouping or none has no menu. */
export function RowsMenu({ tab, group }: { tab: FilterTab; group: Dimension }) {
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

  if (SIDES[tab].rows.length < 2) return null;
  return (
    <div ref={root} className="options">
      <button ref={button} type="button" className="dd" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>
        <span className="dd-caption">{t('rows.caption')}</span>
        <span>{rowsLabel(tab, group)}</span>
      </button>
      {open && (
        <div id={id} className="options-pop rows-pop" role="dialog" aria-label={t('rows.caption')}>
          {SIDES[tab].rows.map((d) => {
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
