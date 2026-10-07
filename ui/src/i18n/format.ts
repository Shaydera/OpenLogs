import { locale, t } from './i18n';

const oneDecimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat(locale);
const megabytes = new Intl.NumberFormat(locale, { style: 'unit', unit: 'megabyte', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
// Log timestamps are zone-less wall-clock values; Rust sends them as if they were UTC.
const clock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
const calendarDate = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
const twoDecimals = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const threeDecimals = new Intl.NumberFormat(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
// Real instants (a download time), unlike log times, are shown in the user's time zone.
const localDate = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' });
const oneDecimalPercent = new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** `value` rounded to `digits` decimals; picks the unit a formatted amount lands in. */
function roundTo(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/** Binary megabytes with one decimal, e.g. `219.7 MB`. */
export function formatBytes(bytes: number): string {
  return megabytes.format(bytes / 1_048_576);
}

/** `m:ss` with floored seconds, e.g. `7:58`. */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Seconds with one decimal, e.g. `12.3 s`; the unit comes from the catalog (en-US Intl writes `sec`). */
export function formatSeconds(ms: number): string {
  return t('unit.seconds', { value: oneDecimal.format(ms / 1000) });
}

/** A 0–100 value with at most one decimal, e.g. `82.2%`. */
export function formatPercent(value: number): string {
  return percent.format(value / 100);
}

export function formatInteger(n: number): string {
  return integer.format(n);
}

export function formatClock(unixMs: number): string {
  return clock.format(unixMs);
}

function formatDate(unixMs: number): string {
  return calendarDate.format(unixMs);
}

/**
 * `512`, `4.9k`, `224k`, `22.49M`, `1.894B`: lower-case k with one decimal below 100k and whole
 * thousands above, two decimals for M, three for B. A value whose rounding reaches the next unit
 * moves there (`999,600` → `1.00M`). Negative amounts get a typographic minus.
 */
export function formatAmount(value: number): string {
  if (value === 0) return whole.format(0);
  if (value < 0) return `−${formatAmount(-value)}`;
  if (roundTo(value / 1e6, 2) >= 1000) return t('unit.billions', { value: threeDecimals.format(value / 1e9) });
  if (roundTo(value / 1e3, 0) >= 1000) return t('unit.millions', { value: twoDecimals.format(value / 1e6) });
  if (roundTo(value / 1e3, 1) >= 100) return t('unit.thousands', { value: whole.format(value / 1e3) });
  if (roundTo(value, 0) >= 1000) return t('unit.thousands', { value: oneDecimal.format(value / 1e3) });
  return whole.format(value);
}

/** Time since the pull started as `m:ss`; prelude times are negative, e.g. `-0:02`. */
export function formatEventTime(ms: number): string {
  return ms < 0 ? `-${formatDuration(-ms)}` : formatDuration(ms);
}

/** A log date with its clock time, e.g. `Oct 7, 2026 · 18:58`. */
export function formatDateTime(unixMs: number): string {
  return t('format.dateTime', { date: formatDate(unixMs), time: formatClock(unixMs) });
}

/** A real instant (not a log time) as a date in the user's time zone, e.g. `Oct 11, 2026`. */
export function formatLocalDate(unixMs: number): string {
  return localDate.format(unixMs);
}

/** Millions with two decimals at every size: `142.44M`, `0.30M`, `−0.18M`. */
export function formatMillions(value: number): string {
  if (value < 0) return `−${formatMillions(-value)}`;
  return t('unit.millions', { value: twoDecimals.format(value / 1e6) });
}

/** A difference in millions with its sign: `+12.34M`, `−13.86M`, `±0`. */
export function formatSignedMillions(value: number): string {
  if (value === 0) return t('unit.noChange');
  return value > 0 ? `+${formatMillions(value)}` : formatMillions(value);
}

/** A 0–100 share with exactly one decimal: `7.5%`, `0.0%`, `100.0%`. */
export function formatShare(value: number): string {
  return oneDecimalPercent.format(value / 100);
}
