import { useRef, useState } from 'react';
import type { FightRow } from '../../api/types';
import { useDismiss } from '../../hooks/useDismiss';
import { t } from '../../i18n/i18n';
import { comparablePulls } from '../../pulls/groupPulls';
import { useApp } from '../../store';
import { pullOptionLabel } from './compareData';

const LIST_ID = 'compare-pulls';

/**
 * "Compare with…": a button listing the other pulls of this boss and difficulty. A list of
 * buttons, not a `<select>`: WebView2 fires `change` on arrow keys, which would open a
 * comparison while a keyboard user is still choosing.
 */
export function CompareMenu({ row }: { row: FightRow }) {
  const log = useApp((s) => s.log);
  const openComparison = useApp((s) => s.openComparison);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useDismiss(root, open, {
    onDismiss: () => setOpen(false),
    onEscape: () => {
      setOpen(false);
      toggleRef.current?.focus();
    },
  });
  const pulls = comparablePulls(log?.fights ?? [], row);
  if (pulls.length === 0) return null;

  return (
    <div ref={root} className="compare-menu">
      <button
        ref={toggleRef}
        type="button"
        className="pill"
        aria-expanded={open}
        aria-controls={open ? LIST_ID : undefined}
        onClick={() => setOpen(!open)}
      >
        {t('compare.open')}
      </button>
      {open && (
        <ul id={LIST_ID} className="compare-list" aria-label={t('compare.choose')}>
          {pulls.map((pull) => (
            <li key={pull.index}>
              <button
                type="button"
                className="compare-option"
                onClick={() => {
                  setOpen(false);
                  void openComparison(pull.index);
                }}
              >
                {pullOptionLabel(pull)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
