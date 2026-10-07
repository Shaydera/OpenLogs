import { describe, expect, it } from 'vitest';
import { logStartMs } from './logStart';

describe('logStartMs', () => {
  it('reads the time from the file name and falls back to the first pull without a valid stamp', () => {
    expect(logStartMs('WoWCombatLog-100726_185823.txt', null)).toBe(Date.UTC(2026, 9, 7, 18, 58, 23));
    expect(logStartMs('Archive-WoWCombatLog-101126_203608.txt', null)).toBe(Date.UTC(2026, 9, 11, 20, 36, 8));
    for (const name of ['raid night.txt', 'WoWCombatLog-131326_000000.txt', 'WoWCombatLog-023126_120000.txt', 'WoWCombatLog-100726_245823.txt']) {
      expect(logStartMs(name, 5), name).toBe(5);
    }
  });
});
