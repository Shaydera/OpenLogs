import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n/i18n';
import { MAX_RANGE_NAME } from './savedRanges';

/**
 * The "+ Save range" form that names the selected range. The caller closes it on Escape and when
 * focus leaves it.
 */
export function SaveRangePopover({ id, onSave, onCancel }: { id: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const trimmed = name.trim();
  return (
    <form
      id={id}
      className="range-popover"
      aria-label={t('range.saveTitle')}
      // Focusable by pointer only: a click on the label or padding keeps focus inside, so the form stays open.
      tabIndex={-1}
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) onSave(trimmed);
      }}
    >
      <label className="cap" htmlFor={`${id}-name`}>
        {t('range.name')}
      </label>
      <input
        ref={inputRef}
        id={`${id}-name`}
        className="input"
        maxLength={MAX_RANGE_NAME}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <div className="range-popover-actions">
        <button type="button" className="pill" onClick={onCancel}>
          {t('range.cancel')}
        </button>
        <button type="submit" className="pill on" disabled={!trimmed}>
          {t('range.save')}
        </button>
      </div>
    </form>
  );
}
