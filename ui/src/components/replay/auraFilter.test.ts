import { describe, expect, it } from 'vitest';
import type { AuraCategory, ReplayAura } from '../../api/types';
import { shownAuras } from './auraFilter';

const aura = (spellId: number, buff: boolean, category: AuraCategory, sourcePlayer: number | null = null): ReplayAura => ({
  target: 10,
  source: 10,
  spellId,
  buff,
  startMs: 0,
  endMs: 1_000,
  stacks: [],
  raidFrame: null,
  category,
  sourcePlayer,
});

const ids = (auras: ReplayAura[]) => auras.map((a) => a.spellId);

describe('shownAuras', () => {
  it('an enemy shows encounter, crowd control, amps, cooldowns and own debuffs', () => {
    const auras = [aura(1, false, 'encounter'), aura(2, false, 'crowdControl'), aura(3, false, 'amp'), aura(4, false, 'cooldown'), aura(5, false, 'other', 7), aura(6, true, 'encounter')];
    expect(ids(shownAuras(auras, 'enemy', 7, false))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("an enemy hides other players' DoTs", () => {
    const auras = [aura(1, false, 'other', 8), aura(2, false, 'other', null), aura(3, true, 'cooldown'), aura(4, true, 'other', 7)];
    expect(shownAuras(auras, 'enemy', 7, false)).toEqual([]);
  });

  it('a player shows cooldown and encounter buffs, encounter and crowd-control debuffs, and hides other auras', () => {
    const auras = [aura(1, true, 'cooldown'), aura(2, true, 'encounter'), aura(3, true, 'other'), aura(4, false, 'other', 8), aura(5, false, 'encounter'), aura(6, false, 'crowdControl')];
    expect(ids(shownAuras(auras, 'player', 7, false))).toEqual([1, 2, 5, 6]);
  });

  it('all shows everything', () => {
    const auras = [aura(1, false, 'other', 8), aura(2, true, 'other')];
    expect(shownAuras(auras, 'enemy', null, true)).toEqual(auras);
  });
});
