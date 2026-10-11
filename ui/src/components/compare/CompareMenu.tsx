import { type FocusEvent, type KeyboardEvent, useRef, useState } from 'react';
import type { FightRow } from '../../api/types';
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
  const toggleRef = useRef<HTMLButtonElement>(null);
  const pulls = comparablePulls(log?.fights ?? [], row);
  if (pulls.length === 0) return null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    setOpen(false);
    toggleRef.current?.focus();
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    // Focus left the menu (Tab past the list, a click elsewhere): close it.
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }

  return (
    <div className="compare-menu" onKeyDown={onKeyDown} onBlur={onBlur}>
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
