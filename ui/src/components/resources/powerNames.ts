import { t, type MessageKey } from '../../i18n/i18n';

const KNOWN = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 16, 17, 18, 19]);

/** WoW power type name; unknown types show their number. */
export function powerName(type: number): string {
  return KNOWN.has(type) ? t(`power.${type}` as MessageKey) : t('power.unknown', { n: type });
}
