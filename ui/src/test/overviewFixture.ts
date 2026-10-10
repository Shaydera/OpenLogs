import type { QuickOverview } from '../api/types';

/** A trimmed Ula'tek kill (Oct 7, 2026) for UI tests. */
export const overviewFixture: QuickOverview = {
  kpis: {
    players: 4,
    durationMs: 478_610,
    raidDamage: 1_894_000_000,
    raidDps: 3_962_000,
    deaths: 2,
    firstDeathMs: 33_200,
    combatPotions: 13,
    playersWithoutCombatPotion: 15,
    healthstones: 3,
    healthPotions: 5,
  },
  timeline: {
    durationMs: 478_610,
    markers: {
      deaths: [
        { t: 33_200, player: 3 },
        { t: 239_100, player: 4 },
      ],
      bloodlust: [{ t: 2_100, player: 4, spellId: 80353 }],
      bossCasts: [
        { t: 20_000, spellId: 1300001 },
        { t: 100_000, spellId: 1300001 },
        { t: 300_000, spellId: 1300001 },
      ],
    },
    bossHpStepMs: 60_000,
    bossHp: [99, 90, null, null, 40, 20, 10, 0],
    dpsStepMs: 120_000,
    raidDps: [3_000_000, 5_000_000, 1_000_000, 4_000_000],
    phases: [
      { kind: 'boss', number: 1, startMs: 0, endMs: 120_000, name: null },
      { kind: 'intermission', number: 1, startMs: 120_000, endMs: 240_000, name: null },
      { kind: 'boss', number: 2, startMs: 240_000, endMs: 478_610, name: null },
    ],
  },
  players: [
    { actorId: 1, name: 'Edrin-Emberfall-EU', specId: 581, specName: 'Vengeance Demon Hunter', classId: 12, classToken: 'DEMONHUNTER', role: 'tank' },
    { actorId: 2, name: 'Pyrrin-Emberfall-EU', specId: 105, specName: 'Restoration Druid', classId: 11, classToken: 'DRUID', role: 'healer' },
    { actorId: 3, name: 'Wendel-Emberfall-EU', specId: 71, specName: 'Arms Warrior', classId: 1, classToken: 'WARRIOR', role: 'damage' },
    { actorId: 4, name: 'Faelan-Emberfall-EU', specId: 62, specName: 'Arcane Mage', classId: 8, classToken: 'MAGE', role: 'damage' },
  ],
  spells: {
    '1236994': { name: 'Potion of Recklessness' },
    '6262': { name: 'Healthstone' },
    '1295247': { name: 'Concentrated Silvermoon Health Potion' },
    '80353': { name: 'Time Warp' },
    '740': { name: 'Tranquility' },
    '365350': { name: 'Arcane Surge' },
    '1300001': { name: 'Virulent Spit' },
    '1297338': { name: 'Deadly Venom' },
    '414658': { name: 'Ice Cold' },
    '110959': { name: 'Greater Invisibility' },
    '118038': { name: 'Die by the Sword' },
  },
  deaths: [
    {
      player: 3,
      playerName: 'Wendel-Emberfall-EU',
      t: 33_200,
      killingBlow: { t: 33_140, spellId: 0, sourceName: 'Gore Rattle', amount: 2_420_251, overkill: 1_380_351, environmental: false, periodic: false },
      damageLast5s: [
        { spellId: 0, amount: 2_420_251, environmental: false },
        { spellId: 1297338, amount: 101_569, environmental: false },
      ],
      damageTaken5s: 2_521_820,
      healingTaken5s: 521_465,
      hpBeforePct: 85,
      resurrectedAt: null,
      context: [
        { item: 'defensive', spellId: 118038, state: 'available', t: null },
        { item: 'healthstone', spellId: 6262, state: 'available', t: null },
        { item: 'health_potion', spellId: 1295247, state: 'available', t: null },
      ],
    },
    {
      player: 4,
      playerName: 'Faelan-Emberfall-EU',
      t: 239_100,
      killingBlow: { t: 239_050, spellId: 1300001, sourceName: "Ula'tek", amount: 355_265, overkill: 4_923, environmental: false, periodic: false },
      damageLast5s: [
        { spellId: 1300001, amount: 710_530, environmental: false },
        { spellId: 1297338, amount: 120_000, environmental: false },
      ],
      damageTaken5s: 830_530,
      healingTaken5s: 0,
      hpBeforePct: 83,
      resurrectedAt: 260_000,
      context: [
        { item: 'healthstone', spellId: 6262, state: 'available', t: null },
        { item: 'health_potion', spellId: 1295247, state: 'available', t: null },
        { item: 'combat_potion', spellId: 1236994, state: 'on_cooldown', t: -2_000 },
        { item: 'defensive', spellId: 414658, state: 'on_cooldown', t: 204_100 },
        { item: 'defensive', spellId: 110959, state: 'used', t: 231_000 },
      ],
    },
  ],
  consumables: [
    { player: 4, t: -2_000, spellId: 1236994, kind: 'combat_potion' },
    { player: 3, t: 126_100, spellId: 1236994, kind: 'combat_potion' },
    { player: 1, t: 67_500, spellId: 6262, kind: 'healthstone' },
    { player: 1, t: 200_000, spellId: 1295247, kind: 'health_potion' },
  ],
  cooldowns: [
    { player: 4, t: 2_100, spellId: 80353, category: 'bloodlust', durationMs: 40_000 },
    { player: 4, t: 700, spellId: 365350, category: 'offensive', durationMs: 15_000 },
    { player: 2, t: 150_000, spellId: 740, category: 'raid_defensive', durationMs: 6_000 },
  ],
};
