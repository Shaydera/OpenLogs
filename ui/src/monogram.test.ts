import { describe, expect, it } from 'vitest';
import { bossMonogram, initials } from './monogram';

describe('monograms', () => {
  it('takes two letters of a boss name without a leading "The", and the initials of two words as written', () => {
    expect(['The Lost Explorers', 'Vashnik the Malignant'].map(bossMonogram)).toEqual(['LO', 'VA']);
    expect(['Arcane Barrage', 'Font of Venomous Rage', 'Melee', '  Time   Warp ', ''].map(initials)).toEqual(['AB', 'Fo', 'M', 'TW', '']);
  });
});
