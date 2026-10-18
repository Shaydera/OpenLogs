import { HEALTH } from '../../api/types';
import { formatAmount, formatDuration, formatOneDecimal, formatSeconds } from '../../i18n/format';
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

const SOUL_SHARDS = 7;
// The log writes these powers in internal units that the game divides for display.
const DISPLAY_DIVISOR: Record<number, number> = { 1: 10, 6: 10, 7: 10, 8: 10, 13: 100 };

/** A sampled power value as the game shows it. Energize amounts are already in these units. */
export function powerInGameUnits(powerType: number, raw: number): number {
  return raw / (DISPLAY_DIVISOR[powerType] ?? 1);
}

/** A sampled power value as text: whole like the game, soul shards with their fraction. */
export function formatPower(powerType: number, raw: number, format: (value: number) => string = formatAmount): string {
  const value = powerInGameUnits(powerType, raw);
  if (powerType === SOUL_SHARDS) return Number.isInteger(value) ? format(value) : formatOneDecimal(value);
  return format(Math.floor(value));
}
