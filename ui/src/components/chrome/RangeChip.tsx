import { formatEventTime } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import type { TimeRange } from '../../store';

/** Detail pages have no Time range panel, so this pill says their figures are filtered; "×" clears the range. */
export function RangeChip({ range, onClear }: { range: TimeRange; onClear: () => void }) {
  const span = `${formatEventTime(range.startMs)}–${formatEventTime(range.endMs)}`;
  return (
    <span className="pill on range-chip">
      <span>{t('range.chip', { span })}</span>
      <button type="button" className="range-chip-x" aria-label={t('range.clear')} onClick={onClear}>
        ×
      </button>
    </span>
  );
}
