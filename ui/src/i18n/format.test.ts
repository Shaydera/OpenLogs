import { describe, expect, it } from 'vitest';
import {
  formatAgo,
  formatAmount,
  formatAmountTenths,
  formatAmountWhole,
  formatBinRange,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatEventTime,
  formatEventTimeTenths,
  formatList,
  formatMillions,
  formatPercent,
  formatSeconds,
  formatShare,
  formatSignedMillions,
} from './format';

describe('formatters (en-US)', () => {
  it.each([
    [
      'amounts, moving into the next unit when rounding reaches it',
      () => [512, 4_920, 224_000, 22_490_000, 1_894_000_000, 999.6, 99_960, 999_600, 999_996_000].map(formatAmount),
      ['512', '4.9k', '224k', '22.49M', '1.894B', '1.0k', '100k', '1.00M', '1.000B'],
    ],
    [
      'whole-k, tenths and millions amounts',
      () => [...[4_923, 999.6, -30_091].map(formatAmountWhole), ...[916, 518_440, 999_960].map(formatAmountTenths), ...[54_464, -177_437, 1_234_567_890].map(formatMillions)],
      ['5k', '1k', '−30k', '916', '518.4k', '1.00M', '0.05M', '−0.18M', '1,234.57M'],
    ],
    [
      'signed differences',
      () => [formatSignedMillions(12_340_000), formatSignedMillions(0)],
      ['+12.34M', '±0'],
    ],
    [
      'pull times and times before an event',
      () => [formatDuration(478_610), formatEventTime(-2_000), formatEventTimeTenths(148_990), formatEventTimeTenths(-1_500), formatAgo(35_900), formatAgo(91_000), formatAgo(-500)],
      ['7:58', '-0:02', '2:29.0', '-0:01.5', '−35 s', '−1:31', '−0 s'],
    ],
    [
      'units and histogram bins',
      () => [formatBytes(230_331_451), formatSeconds(12_303), formatPercent(58.436), formatPercent(100), formatShare(0.04), formatBinRange(50_000, 100_000), formatBinRange(500_000, 1_000_000)],
      ['219.7 MB', '12.3 s', '58.4%', '100%', '0.0%', '50–100k', '500k–1M'],
    ],
    [
      'zone-less log times and lists',
      () => [formatDateTime(Date.UTC(2026, 9, 7, 18, 58, 23)), formatList([]), formatList(['Ice Cold', 'Alter Time']), formatList(['Ice Cold', 'Greater Invisibility', 'Alter Time'])],
      ['Oct 7, 2026 · 18:58', '', 'Ice Cold and Alter Time', 'Ice Cold, Greater Invisibility and Alter Time'],
    ],
  ])('writes the %s', (_, actual, expected) => {
    expect(actual()).toEqual(expected);
  });
});
