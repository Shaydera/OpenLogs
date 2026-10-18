import { describe, expect, it } from 'vitest';
import { formatPower, powerInGameUnits } from './powerNames';

const RAGE = 1;
const MANA = 0;
const SOUL_SHARDS = 7;
const INSANITY = 13;

describe('powers in game units', () => {
  it('divides the powers the log writes in internal units and leaves the others alone', () => {
    expect(powerInGameUnits(RAGE, 1300)).toBe(130);
    expect(powerInGameUnits(INSANITY, 10_000)).toBe(100);
    expect(powerInGameUnits(MANA, 250_000)).toBe(250_000);
  });

  it('shows soul shard fragments with a decimal only where a fraction appears', () => {
    expect(formatPower(SOUL_SHARDS, 50)).toBe('5');
    expect(formatPower(SOUL_SHARDS, 25)).toBe('2.5');
  });

  it('shows whole rage as the game does, without rounding up', () => {
    expect(formatPower(RAGE, 807)).toBe('80');
  });
});
