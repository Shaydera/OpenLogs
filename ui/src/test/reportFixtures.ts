import type { AbilityDetail, DamageReport, DamageTakenReport, DeathRecap, DeathsReport, HealingReport, PlayerDetail, PlayerRef, TargetDetail } from '../api/types';

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

export const playerDetailFixture: PlayerDetail = {
  player: roster[1],
  specName: 'Arcane Mage',
  itemLevel: 334,
  maxHp: 959_000,
  metric: 'damage',
  attribution: 'reattributed',
  startMs: 0,
  endMs: 20_000,
  total: 103_233_825,
  otherModeTotal: 117_091_704,
  perSecond: 215_691,
  rank: 3,
  rankedPlayers: 3,
  supportReceived: 13_857_879,
  supportReceivedFrom: [{ player: 5, amount: 13_857_879 }],
  supportBySpell: [
    { spellId: 409311, amount: 5_978_978 },
    { spellId: 404908, amount: 4_369_588 },
    { spellId: 395152, amount: 3_509_313 },
  ],
  healingReceived: 18_970_000,
  deaths: [
    {
      t: 12_000,
      resurrectedAt: 16_000,
      killingBlow: { t: 12_000, spellId: 1300001, sourceName: "Ula'tek", amount: 355_265, overkill: 4_923, environmental: false, periodic: false },
      resurrectedBy: { spellId: 20484, source: 2 },
      lethalBurst: { spellId: 1300001, count: 2, windowMs: 1_000 },
      context: [
        { item: 'defensive', spellId: 414658, state: 'on_cooldown', t: 4_000 },
        { item: 'defensive', spellId: 110959, state: 'on_cooldown', t: 6_000 },
        { item: 'defensive', spellId: 342245, state: 'on_cooldown', t: 7_000 },
        { item: 'healthstone', spellId: 6262, state: 'available', t: null },
        { item: 'health_potion', spellId: 1234768, state: 'available', t: null },
      ],
    },
  ],
  consumables: [],
  abilities: [
    { spellId: 5143, actorId: 4, actorName: 'Faelan-Emberfall-EU', kind: 'own', amount: 37_985_527, overheal: 0, hits: 1_325, crits: 340, maxHit: 242_663, ticks: 0, casts: 85, aug: false, pets: 0 },
    { spellId: 44425, actorId: 4, actorName: 'Faelan-Emberfall-EU', kind: 'own', amount: 22_487_648, overheal: 0, hits: 117, crits: 47, maxHit: 1_056_506, ticks: 0, casts: 67, aug: false, pets: 0 },
    { spellId: 404908, actorId: 4, actorName: 'Faelan-Emberfall-EU', kind: 'own', amount: 4_369_588, overheal: 0, hits: 69, crits: 0, maxHit: 1_857_443, ticks: 0, casts: null, aug: true, pets: 0 },
    { spellId: 88084, actorId: 40, actorName: 'Mirror Image', kind: 'pet', amount: 1_319_969, overheal: 0, hits: 120, crits: 20, maxHit: 30_000, ticks: 0, casts: null, aug: false, pets: 2 },
    { spellId: 409311, actorId: 5, actorName: 'Speronis-Stonevale-EU', kind: 'support_deducted', amount: -5_978_978, overheal: 0, hits: 300, crits: 0, maxHit: 0, ticks: 0, casts: null, aug: false, pets: 0 },
  ],
  petAbilities: [
    { spellId: 59638, actorId: 40, actorName: 'Mirror Image', kind: 'pet', amount: 1_000_000, overheal: 0, hits: 100, crits: 15, maxHit: 30_000, ticks: 0, casts: null, aug: false, pets: 0 },
    { spellId: 449569, actorId: 41, actorName: 'Arcane Phoenix', kind: 'pet', amount: 319_969, overheal: 0, hits: 20, crits: 5, maxHit: 25_000, ticks: 0, casts: null, aug: false, pets: 0 },
  ],
  takenBySpell: [{ spellId: 1300001, amount: 2_000_000, environmental: false }],
  seriesStepMs: 5_000,
  series: [200_000, 400_000, 0, 150_000],
  castRows: [
    { spellId: 365350, kind: 'major', durationMs: 15_000, times: [700, 13_340], link: null },
    { spellId: 414658, kind: 'defensive', durationMs: 0, times: [8_000], link: null },
  ],
  castTimeline: [
    { spellId: 44425, kind: 'rotation', durationMs: 0, times: [1_000, 3_000, 5_000], link: { spellId: 44425, metric: 'damage' } },
    { spellId: 365350, kind: 'rotation', durationMs: 0, times: [700, 13_340], link: null },
  ],
  buffRows: [
    { spellId: 395152, source: 5, kind: 'aug', intervals: [[500, 6_590], [7_370, 16_610]], uptime: 0.766 },
    { spellId: 365362, source: 4, kind: 'cooldown', intervals: [[700, 1_810], [13_340, 15_080]], uptime: 0.15 },
  ],
  ebonMight: [[500, 6_590], [7_370, 16_610]],
  dead: [[12_000, 16_000]],
  deadSince: null,
  augmentation: [],
  mana: [60, 40, null, 90],
  roster: [...roster].sort((a, b) => a.name.localeCompare(b.name)),
  spells: {
    ...spells,
    '5143': { name: 'Arcane Missiles' },
    '404908': { name: 'Fate Mirror' },
    '88084': { name: 'Arcane Blast' },
    '365350': { name: 'Arcane Surge' },
    '365362': { name: 'Arcane Surge' },
    '414658': { name: 'Ice Cold' },
    '20484': { name: 'Rebirth' },
    '110959': { name: 'Greater Invisibility' },
    '342245': { name: 'Alter Time' },
    '6262': { name: 'Healthstone' },
    '1234768': { name: 'Silvermoon Health Potion' },
    '59638': { name: 'Frostbolt' },
    '449569': { name: 'Meteorite' },
  },
};

/** Faelan's Arcane Barrage over 20 s. */
export const abilityDetailFixture: AbilityDetail = {
  player: roster[1],
  spellId: 44425,
  spellName: 'Arcane Barrage',
  school: 64,
  pet: null,
  metric: 'damage',
  startMs: 0,
  endMs: 20_000,
  total: 2_300_000,
  playerTotal: 10_000_000,
  casts: [1_000, 6_000, 11_000, 16_000],
  hits: [
    { t: 1_100, target: 10, amount: 300_000, critical: false, periodic: false },
    { t: 1_100, target: 11, amount: 200_000, critical: false, periodic: false },
    { t: 6_100, target: 10, amount: 1_056_506, critical: true, periodic: false },
    { t: 11_100, target: 10, amount: 400_000, critical: true, periodic: false },
    { t: 16_100, target: 12, amount: 343_494, critical: false, periodic: false },
  ],
  byTarget: [
    { name: "Ula'tek", hits: 3, crits: 2, amount: 1_756_506 },
    { name: 'Blightscale Rawling', hits: 2, crits: 0, amount: 543_494 },
  ],
  median: 343_494,
  uptime: null,
  dead: [[12_000, 16_000]],
  targetNames: { '10': "Ula'tek", '11': 'Blightscale Rawling', '12': 'Blightscale Rawling' },
  playerTargets: [],
};

/** Blightscale Rawlings over 60 s. */
export const targetDetailFixture: TargetDetail = {
  name: 'Blightscale Rawling',
  startMs: 0,
  endMs: 60_000,
  damageTaken: 550_000,
  raidDamage: 2_200_000,
  maxHp: 7_510_000,
  isBoss: false,
  sharesBossHp: false,
  primary: false,
  units: [
    { actor: 20, firstHit: 1_000, lastHit: 7_000, death: 8_000 },
    { actor: 21, firstHit: 3_000, lastHit: 9_000, death: null },
    { actor: 22, firstHit: 20_000, lastHit: 34_000, death: 36_000 },
  ],
  waves: [
    { startMs: 1_000, units: 2, killed: 1, clearMs: 8_000, avgLifeMs: 7_000 },
    { startMs: 20_000, units: 1, killed: 1, clearMs: 16_000, avgLifeMs: 16_000 },
  ],
  byPlayer: [
    { player: 4, amount: 300_000 },
    { player: 3, amount: 250_000 },
  ],
  enemies: [
    { name: "Ula'tek", units: 1, damageTaken: 1_000_000, isBoss: true, sharesBossHp: false, primary: true },
    { name: 'Blightscale Rawling', units: 3, damageTaken: 550_000, isBoss: false, sharesBossHp: false, primary: false },
    { name: 'Gore Rattle', units: 1, damageTaken: 650_000, isBoss: false, sharesBossHp: true, primary: false },
  ],
  roster,
};

/** Faelan's death in the reference pull, with its events, HP and context. */
const faelanRecap: DeathRecap = {
  player: 4,
  playerName: 'Faelan-Emberfall-EU',
  t: 239_100,
  killingBlow: { t: 239_100, spellId: 1302982, sourceName: "Ula'tek", amount: 355_265, overkill: 4_923, environmental: false, periodic: false },
  damageLast5s: [{ spellId: 1302982, amount: 710_530, environmental: false }],
  damageTaken5s: 1_060_000,
  healingTaken5s: 224_000,
  hpBeforePct: 83.4,
  resurrectedAt: 259_548,
  context: [
    { item: 'defensive', spellId: 414658, state: 'on_cooldown', t: 204_000 },
    { item: 'defensive', spellId: 110959, state: 'on_cooldown', t: 212_600 },
    { item: 'defensive', spellId: 235450, state: 'used', t: 215_100 },
    { item: 'healthstone', spellId: 6262, state: 'available', t: null },
    { item: 'health_potion', spellId: 1234768, state: 'available', t: null },
    { item: 'combat_potion', spellId: 1236994, state: 'available', t: null },
  ],
  number: 4,
  specName: 'Arcane Mage',
  maxHp: 959_133,
  resurrectedBy: { spellId: 20484, source: 6 },
  lethalBurst: { spellId: 1302982, count: 2, windowMs: 1_010 },
  events: [
    { t: 231_990, spellId: 1286835, sourceName: "Ula'tek", kind: 'damage', amount: 33_163, absorbed: 0, excess: 0, hpPct: 94, environmental: false, periodic: false, sourceOwnerName: null },
    { t: 236_470, spellId: 1297338, sourceName: null, kind: 'damage', amount: 45_999, absorbed: 0, excess: 0, hpPct: 68, environmental: false, periodic: true, sourceOwnerName: null },
    { t: 236_728, spellId: 1267745, sourceName: 'Stormstream Totem', kind: 'heal', amount: 14_195, absorbed: 0, excess: 0, hpPct: null, environmental: false, periodic: true, sourceOwnerName: 'Mulgar-Emberfall-EU' },
    { t: 237_990, spellId: 1286835, sourceName: "Ula'tek", kind: 'damage', amount: 35_444, absorbed: 0, excess: 0, hpPct: 74, environmental: false, periodic: false, sourceOwnerName: null },
    { t: 238_090, spellId: 1302982, sourceName: "Ula'tek", kind: 'damage', amount: 355_265, absorbed: 0, excess: 0, hpPct: 36, environmental: false, periodic: false, sourceOwnerName: null },
    { t: 238_270, spellId: 1287908, sourceName: 'Faelan-Emberfall-EU', kind: 'heal', amount: 12_552, absorbed: 0, excess: 0, hpPct: null, environmental: false, periodic: false, sourceOwnerName: null },
    { t: 238_600, spellId: 235450, sourceName: 'Faelan-Emberfall-EU', kind: 'absorb', amount: 20_000, absorbed: 0, excess: 0, hpPct: null, environmental: false, periodic: false, sourceOwnerName: null },
    { t: 239_100, spellId: 1302982, sourceName: "Ula'tek", kind: 'damage', amount: 394_738, absorbed: 39_473, excess: 4_923, hpPct: 0, environmental: false, periodic: false, sourceOwnerName: null },
  ],
  hp: [
    { t: 231_100, pct: 95 },
    { t: 236_470, pct: 68 },
    { t: 237_990, pct: 74 },
    { t: 238_090, pct: 36 },
    { t: 239_100, pct: 0 },
  ],
  buffs: [],
};

/** The Deaths tab: Faelan's death and the druid who resurrected him. */
export const recapFixture: DeathsReport = {
  roster: [
    { actorId: 4, name: 'Faelan-Emberfall-EU', specId: 62, specName: 'Arcane Mage', classId: 8, classToken: 'MAGE', role: 'damage' },
    { actorId: 6, name: 'Serrik-Silverbrook-EU', specId: 105, specName: 'Restoration Druid', classId: 11, classToken: 'DRUID', role: 'healer' },
  ],
  spells: {
    '1302982': { name: 'Virulent Spit' },
    '1286835': { name: 'Necrotic Vapors' },
    '1297338': { name: 'Deadly Venom' },
    '1267745': { name: 'Stormstream Totem' },
    '1287908': { name: 'Rune of Self-Mending' },
    '414658': { name: 'Ice Cold' },
    '110959': { name: 'Greater Invisibility' },
    '235450': { name: 'Prismatic Barrier' },
    '6262': { name: 'Healthstone' },
    '1234768': { name: 'Concentrated Silvermoon Health Potion' },
    '1236994': { name: 'Potion of Recklessness' },
    '1236616': { name: "Light's Potential" },
    '20484': { name: 'Rebirth' },
  },
  deaths: [faelanRecap],
};

export const deathsReportFixture: DeathsReport = recapFixture;
