import { locale, t } from './i18n';

const oneDecimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const upToOneDecimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
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
const plain = new Intl.NumberFormat(locale, { maximumFractionDigits: 0, useGrouping: false });
const oneDecimalPercent = new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const oneDecimalUngrouped = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false });

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

/** A Mythic+ keystone level, e.g. `+12`. */
export function formatKeystoneLevel(level: number): string {
  return t('runs.level', { level: formatInteger(level) });
}

/** Seconds with one decimal, e.g. `12.3 s`; the unit comes from the catalog (en-US Intl writes `sec`). */
export function formatSeconds(ms: number): string {
  return t('unit.seconds', { value: oneDecimal.format(ms / 1000) });
}

/** A 0–100 value with at most one decimal, e.g. `82.2%`. */
export function formatPercent(value: number): string {
  return percent.format(value / 100);
}

/** Exactly `digits` decimals, grouped, e.g. `1.25` (hits per cast). */
export function formatFixed(value: number, digits: number): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
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

/** An amount with an explicit sign, e.g. `+87.29M`, `−8.28M`; zero is `0`. */
export function formatSignedAmount(value: number): string {
  if (value === 0) return formatAmount(0);
  return value > 0 ? `+${formatAmount(value)}` : formatAmount(value);
}

/** A log date with its clock time, e.g. `Oct 7, 2026 · 18:58`. */
export function formatDateTime(unixMs: number): string {
  return t('format.dateTime', { date: formatDate(unixMs), time: formatClock(unixMs) });
}

/** A real instant (not a log time) as a date in the user's time zone, e.g. `Oct 11, 2026`. */
export function formatLocalDate(unixMs: number): string {
  return localDate.format(unixMs);
}

/** A signed `m:ss` difference, e.g. `+5:36`, `−0:14`; under a second reads `0:00`. */
export function formatSignedDuration(ms: number): string {
  if (Math.abs(ms) < 1000) return formatDuration(0);
  return `${ms > 0 ? '+' : '−'}${formatDuration(Math.abs(ms))}`;
}

/** A signed, grouped count difference, e.g. `+10`, `−1,200`, `0`. */
export function formatSignedInteger(n: number): string {
  if (n === 0) return formatInteger(0);
  return `${n > 0 ? '+' : '−'}${formatInteger(Math.abs(n))}`;
}

/**
 * Whole thousands below a million (`5k`, `96k`, `244k`), else like `formatAmount` (`2.42M`). A value
 * whose rounding reaches the next unit moves there (`999.6` → `1k`, `999,600` → `1.00M`).
 */
export function formatAmountWhole(value: number): string {
  if (value < 0) return `−${formatAmountWhole(-value)}`;
  if (roundTo(value / 1e3, 0) < 1000 && roundTo(value, 0) >= 1000) {
    return t('unit.thousands', { value: whole.format(value / 1e3) });
  }
  return formatAmount(value);
}

/** Time back from an event, floored: `−35 s` under a minute, else `−1:31`. */
export function formatAgo(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  const span = seconds < 60 ? t('unit.seconds', { value: whole.format(seconds) }) : formatDuration(seconds * 1000);
  return `−${span}`;
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

/** Two decimals at every unit: `845`, `300.24k`, `142.44M`, `1.90B`; rounding into the next unit moves there. */
export function formatScaled(value: number): string {
  if (value < 0) return `−${formatScaled(-value)}`;
  if (roundTo(value / 1e6, 2) >= 1000) return t('unit.billions', { value: twoDecimals.format(value / 1e9) });
  if (roundTo(value / 1e3, 2) >= 1000) return t('unit.millions', { value: twoDecimals.format(value / 1e6) });
  if (roundTo(value, 0) >= 1000) return t('unit.thousands', { value: twoDecimals.format(value / 1e3) });
  return whole.format(value);
}

/** `formatScaled` with an explicit sign: `+87.29M`, `−8.28M`, `±0`. */
export function formatSignedScaled(value: number): string {
  if (value === 0) return t('unit.noChange');
  return value > 0 ? `+${formatScaled(value)}` : formatScaled(value);
}

/** Casts per minute with one decimal and no grouping: `59.0`, `1006.8`. */
export function formatCpm(value: number): string {
  return oneDecimalUngrouped.format(value);
}

/**
 * One-decimal `k` at every size below a million (`28.7k`, `242.7k`, `518.4k`), plain below a
 * thousand (`916`), else like `formatAmount` (`11.30M`). Rounding into the next unit moves there
 * (`999,960` → `1.00M`).
 */
export function formatAmountTenths(value: number): string {
  if (value < 0) return `−${formatAmountTenths(-value)}`;
  if (roundTo(value / 1e3, 1) >= 1000) return formatAmount(value);
  if (roundTo(value, 0) >= 1000) return t('unit.thousands', { value: oneDecimal.format(value / 1e3) });
  return plain.format(value);
}

/** A count without grouping: `1325`. */
export function formatCount(n: number): string {
  return plain.format(n);
}

/** Time since the pull with milliseconds as the log has them: `2:10.007`; prelude times are negative. */
export function formatEventTimeMs(ms: number): string {
  const whole = Math.abs(ms);
  const text = `${formatDuration(whole)}.${String(whole % 1000).padStart(3, '0')}`;
  return ms < 0 ? `-${text}` : text;
}

/** A length of time: seconds below a minute (`20 s`, `2.5 s`), else `m:ss`. */
export function formatSpan(ms: number): string {
  return ms < 60_000 ? t('unit.seconds', { value: upToOneDecimal.format(ms / 1000) }) : formatDuration(ms);
}

/** Seconds with two decimals, e.g. `1.20 s` (cast and hold times). */
export function formatSecondsExact(ms: number): string {
  return t('unit.seconds', { value: twoDecimals.format(ms / 1000) });
}

/** Time since the pull with tenths, rounded to 100 ms: `0:04.2` (hit log, death recap). */
export function formatEventTimeTenths(ms: number): string {
  const tenths = Math.round(Math.abs(ms) / 100);
  const text = `${formatDuration(Math.floor(tenths / 10) * 1000)}.${tenths % 10}`;
  return ms < 0 ? `-${text}` : text;
}

/** A chart's y ceiling: one-decimal `M` (`3.0M`), whole `k` (`450k`), else plain. */
export function formatAxisAmount(value: number): string {
  if (roundTo(value / 1e3, 0) >= 1000) return t('unit.millions', { value: oneDecimal.format(value / 1e6) });
  if (roundTo(value, 0) >= 1000) return t('unit.thousands', { value: whole.format(value / 1e3) });
  return whole.format(value);
}

/** A histogram edge: at most one decimal, `50k`, `1.2M`, `2.5k`, `200`. */
export function formatBinAmount(value: number): string {
  if (roundTo(value / 1e3, 1) >= 1000) return t('unit.millions', { value: upToOneDecimal.format(value / 1e6) });
  if (roundTo(value, 0) >= 1000) return t('unit.thousands', { value: upToOneDecimal.format(value / 1e3) });
  return whole.format(value);
}

/** A histogram bin `50–100k`: the unit once when both edges share it, else both (`500k–1M`). */
export function formatBinRange(from: number, to: number): string {
  const a = formatBinAmount(from);
  const b = formatBinAmount(to);
  const unit = (text: string) => text.replace(/^[\d.,]+/, '');
  const shared = unit(a) !== '' && unit(a) === unit(b);
  return `${shared ? a.slice(0, a.length - unit(a).length) : a}–${b}`;
}

/** `a`, `a and b`, `a, b and c` (no serial comma). */
export function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return t('format.listAnd', { list: items.slice(0, -1).join(', '), last: items[items.length - 1] });
}

/** Time before an event with two decimals: `−0.07 s`. */
export function formatOffsetSeconds(ms: number): string {
  return `−${t('unit.seconds', { value: twoDecimals.format(Math.max(0, ms) / 1000) })}`;
}
