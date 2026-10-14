import { HEALTH } from '../../api/types';
import { formatDuration, formatSeconds } from '../../i18n/format';
import { t, type MessageKey } from '../../i18n/i18n';

const KNOWN = new Set([HEALTH, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 16, 17, 18, 19]);

/** WoW power type name; unknown types show their number. */
export function powerName(type: number): string {
  return KNOWN.has(type) ? t(`power.${type}` as MessageKey) : t('power.unknown', { n: type });
}

/** Time at cap; a minute and more as m:ss like every other duration. */
export function formatCapTime(ms: number): string {
  return ms <= 0 ? '—' : ms < 60_000 ? formatSeconds(ms) : formatDuration(ms);
}
