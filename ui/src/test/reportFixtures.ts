import type { DamageReport, DamageTakenReport, HealingReport, PlayerRef } from '../api/types';

const roster: PlayerRef[] = [
  { actorId: 3, name: 'Wendel-Emberfall-EU', specId: 71, specName: 'Arms Warrior', classId: 1, classToken: 'WARRIOR', role: 'damage' },
  { actorId: 4, name: 'Faelan-Emberfall-EU', specId: 62, specName: 'Arcane Mage', classId: 8, classToken: 'MAGE', role: 'damage' },
  { actorId: 5, name: 'Speronis-Stonevale-EU', specId: 1473, specName: 'Augmentation Evoker', classId: 13, classToken: 'EVOKER', role: 'damage' },
  { actorId: 2, name: 'Pyrrin-Emberfall-EU', specId: 105, specName: 'Restoration Druid', classId: 11, classToken: 'DRUID', role: 'healer' },
];

const spells = {
  '12294': { name: 'Mortal Strike' },
  '44425': { name: 'Arcane Barrage' },
  '395152': { name: 'Ebon Might' },
  '409311': { name: 'Prescience' },
  '774': { name: 'Rejuvenation' },
  '1300001': { name: 'Virulent Spit' },
};

/** Reattributed mode: Speronis is credited with the support from his buffs. */
export const damageReportFixture: DamageReport = {
  durationMs: 478_610,
  total: 370_958_510,
  roster,
  spells,
  players: [
    {
      player: 3, own: 150_715_071, supportReceived: 8_279_903, supportGiven: 0, supportSelf: 0, total: 142_435_168, perSecond: 297_597, share: 0.384,
      abilities: [
        { spellId: 12294, actorId: 3, actorName: 'Wendel-Emberfall-EU', kind: 'own', amount: 150_715_071, overheal: 0, hits: 120, crits: 40, maxHit: 2_400_000, ticks: 0 },
        { spellId: 395152, actorId: 5, actorName: 'Speronis-Stonevale-EU', kind: 'support_deducted', amount: -8_279_903, overheal: 0, hits: 400, crits: 0, maxHit: 0, ticks: 0 },
      ],
      supportByRecipient: [],
      supportReceivedFrom: [{ player: 5, amount: 8_279_903 }],
    },
    {
      player: 5, own: 37_995_893, supportReceived: 0, supportGiven: 87_293_624, supportSelf: 177_400, total: 125_289_517, perSecond: 261_778, share: 0.338,
      abilities: [
        { spellId: 395152, actorId: 5, actorName: 'Speronis-Stonevale-EU', kind: 'support_given', amount: 50_177_400, overheal: 0, hits: 900, crits: 0, maxHit: 0, ticks: 0 },
        { spellId: 44425, actorId: 5, actorName: 'Speronis-Stonevale-EU', kind: 'own', amount: 37_995_893, overheal: 0, hits: 90, crits: 30, maxHit: 900_000, ticks: 0 },
        { spellId: 409311, actorId: 5, actorName: 'Speronis-Stonevale-EU', kind: 'support_given', amount: 37_293_624, overheal: 0, hits: 700, crits: 0, maxHit: 0, ticks: 0 },
        // Reattributed: his own buff share, credited inside the support rows and deducted again.
        { spellId: 395152, actorId: 5, actorName: 'Speronis-Stonevale-EU', kind: 'support_deducted', amount: -177_400, overheal: 0, hits: 100, crits: 0, maxHit: 0, ticks: 0 },
      ],
      supportByRecipient: [{ player: 4, amount: 13_857_879 }, { player: 3, amount: 8_279_903 }],
      supportReceivedFrom: [],
    },
    {
      player: 4, own: 117_091_704, supportReceived: 13_857_879, supportGiven: 0, supportSelf: 0, total: 103_233_825, perSecond: 215_691, share: 0.278,
      abilities: [
        { spellId: 44425, actorId: 4, actorName: 'Faelan-Emberfall-EU', kind: 'own', amount: 117_091_704, overheal: 0, hits: 300, crits: 120, maxHit: 1_056_506, ticks: 0 },
        { spellId: 409311, actorId: 5, actorName: 'Speronis-Stonevale-EU', kind: 'support_deducted', amount: -13_857_879, overheal: 0, hits: 300, crits: 0, maxHit: 0, ticks: 0 },
      ],
      supportByRecipient: [],
      supportReceivedFrom: [{ player: 5, amount: 13_857_879 }],
    },
  ],
};

export const healingReportFixture: HealingReport = {
  durationMs: 478_610,
  total: 60_000_000,
  overheal: 40_000_000,
  roster,
  spells,
  players: [
    {
      player: 2, healing: 55_000_000, absorbs: 5_000_000, overheal: 40_000_000, supportReceived: 0, supportGiven: 0, supportSelf: 0, total: 60_000_000,
      perSecond: 125_363, share: 1,
      abilities: [{ spellId: 774, actorId: 2, actorName: 'Pyrrin-Emberfall-EU', kind: 'own', amount: 55_000_000, overheal: 40_000_000, hits: 2_000, crits: 300, maxHit: 120_000, ticks: 1_900 }],
      supportByRecipient: [],
      supportReceivedFrom: [],
    },
  ],
};

export const takenReportFixture: DamageTakenReport = {
  durationMs: 478_610,
  total: 3_000_000,
  roster,
  spells,
  byAbility: [
    { spellId: 1300001, sourceName: "Ula'tek", sourceId: null, environmental: false, amount: 2_000_000, absorbed: 100_000, hits: 12, playersHit: 6 },
    { spellId: 0, sourceName: 'Gore Rattle', sourceId: null, environmental: false, amount: 1_000_000, absorbed: 0, hits: 4, playersHit: 1 },
  ],
  byPlayer: [
    {
      player: 4, amount: 2_000_000, absorbed: 100_000, perSecond: 4_179, share: 0.667,
      abilities: [{ spellId: 1300001, sourceName: "Ula'tek", sourceId: null, environmental: false, amount: 2_000_000, absorbed: 100_000, hits: 12, playersHit: 1 }],
    },
    {
      player: 3, amount: 1_000_000, absorbed: 0, perSecond: 2_089, share: 0.333,
      abilities: [{ spellId: 0, sourceName: 'Gore Rattle', sourceId: null, environmental: false, amount: 1_000_000, absorbed: 0, hits: 4, playersHit: 1 }],
    },
  ],
};
