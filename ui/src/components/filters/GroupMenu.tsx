import { useId, useRef, useState } from 'react';
import type { Dimension } from '../../api/types';
import { useDismiss } from '../../hooks/useDismiss';
import { type MessageKey, t } from '../../i18n/i18n';
import { type FilterTab, SIDES } from '../../scopeSides';
import { useApp } from '../../store';

const LABELS: Partial<Record<FilterTab, Partial<Record<Dimension, MessageKey>>>> = {
  damage: { source: 'rows.done.source', ability: 'rows.done.ability', target: 'rows.done.target' },
  healing: { source: 'rows.healing.source', ability: 'rows.healing.ability', target: 'rows.healing.target' },
  taken: { target: 'rows.taken.target', ability: 'rows.taken.ability', source: 'rows.taken.source' },
  casts: { source: 'rows.casts.source', ability: 'rows.casts.ability' },
  interrupts: { source: 'rows.kicks.source', ability: 'rows.kicks.ability', target: 'rows.kicks.target' },
  buffs: { ability: 'rows.auras.ability', target: 'rows.auras.target' },
};

/** A grouping's name on its tab ("Done by Source"); the picker caption where the tab has no phrase for it. */
export const groupLabel = (tab: FilterTab, dimension: Dimension): string => t(LABELS[tab]?.[dimension] ?? SIDES[tab].captions[dimension]);

/** A tab's choice of dimension, such as its rows or lanes; a tab with fewer than two has none. A dimension narrowed to one value stays visible, disabled. */
export function GroupMenu({ tab, caption, value, onPick }: { tab: FilterTab; caption: string; value: Dimension; onPick: (dimension: Dimension) => void }) {
  const scope = useApp((s) => s.scope);
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
        <span className="dd-caption">{caption}</span>
        <span>{groupLabel(tab, value)}</span>
      </button>
      {open && (
        <div id={id} className="options-pop rows-pop" role="dialog" aria-label={caption}>
          {SIDES[tab].rows.map((d) => {
            const narrowed = scope[d].length > 0;
            return (
              <button
                key={d}
                type="button"
                className={d === value ? 'opt on' : 'opt'}
                aria-pressed={d === value}
                disabled={narrowed}
                onClick={() => {
                  setOpen(false);
                  onPick(d);
                }}
              >
                {groupLabel(tab, d)}
                {narrowed && <span className="options-hint">{t('rows.filtered')}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
