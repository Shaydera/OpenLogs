import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatEventTime,
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
      'millions amounts',
      () => [54_464, -177_437, 1_234_567_890].map(formatMillions),
      ['0.05M', '−0.18M', '1,234.57M'],
    ],
    [
      'signed differences',
      () => [formatSignedMillions(12_340_000), formatSignedMillions(0)],
      ['+12.34M', '±0'],
    ],
    [
      'pull times',
      () => [formatDuration(478_610), formatEventTime(-2_000)],
      ['7:58', '-0:02'],
    ],
    [
      'units',
      () => [formatBytes(230_331_451), formatSeconds(12_303), formatPercent(58.436), formatPercent(100), formatShare(0.04)],
      ['219.7 MB', '12.3 s', '58.4%', '100%', '0.0%'],
    ],
    [
      'zone-less log times',
      () => [formatDateTime(Date.UTC(2026, 9, 7, 18, 58, 23))],
      ['Oct 7, 2026 · 18:58'],
    ],
  ])('writes the %s', (_, actual, expected) => {
    expect(actual()).toEqual(expected);
  });
});
