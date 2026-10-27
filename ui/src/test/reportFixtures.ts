import type { AbilityDetail, AuraLane, AuraRow, AurasReport, CastsReport, Breakdown, DamageReport, DamageTakenReport, DeathRecap, DeathsReport, HealingReport, InterruptsReport, PlayerAbility, PlayerDetail, PlayerRef, ReportUnit, ResourcesReport, TargetDetail } from '../api/types';

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
  colorGroups: ["Ula'tek", 'Venomous Heart', 'Blightscale Rawling', 'Weakened Doomscale'],
  players: [
    {
      player: 3, own: 150_715_071, supportReceived: 8_279_903, supportGiven: 0, supportSelf: 0, total: 142_435_168, perSecond: 297_597, share: 0.384,
      abilities: [
        { spellId: 12294, actorId: 3, actorName: 'Wendel-Emberfall-EU', kind: 'own', amount: 142_435_168, support: 8_279_903, overheal: 0, hits: 120, crits: 40, maxHit: 2_400_000, ticks: 0 },
      ],
      supportByRecipient: [],
      supportReceivedFrom: [{ player: 5, amount: 8_279_903 }],
      supportReceivedByBuff: [{ buffId: 395152, evoker: 5, amount: 8_279_903 }],
      supportCreditedByBuff: [],
      targets: [{ target: { kind: 'unit', name: "Ula'tek", player: null, units: 1 }, amount: 80000000, absorbed: 0, healAbsorbed: 0, hits: 10, crits: 2 }, { target: { kind: 'unit', name: "Blightscale Rawling", player: null, units: 58 }, amount: 40000000, absorbed: 0, healAbsorbed: 0, hits: 10, crits: 2 }, { target: { kind: 'unit', name: "Gore Rattle", player: null, units: 2 }, amount: 22435168, absorbed: 0, healAbsorbed: 0, hits: 10, crits: 2 }],
      groupAbilities: [{ group: "Blightscale Rawling", abilities: [{ spellId: 12294, amount: 30_000_000 }] }, { group: "Ula'tek", abilities: [{ spellId: 12294, amount: 60_000_000 }] }],
    },
    {
      player: 5, own: 37_995_893, supportReceived: 0, supportGiven: 87_293_624, supportSelf: 177_400, total: 125_289_517, perSecond: 261_778, share: 0.338,
      abilities: [
        // Reattributed: his own buff share moved from his Arcane Barrage into his Ebon Might row.
        { spellId: 395152, actorId: 5, actorName: 'Speronis-Stonevale-EU', kind: 'support_given', amount: 50_177_400, support: 0, overheal: 0, hits: 900, crits: 0, maxHit: 0, ticks: 0 },
        { spellId: 44425, actorId: 5, actorName: 'Speronis-Stonevale-EU', kind: 'own', amount: 37_818_493, support: 177_400, overheal: 0, hits: 90, crits: 30, maxHit: 900_000, ticks: 0 },
        { spellId: 409311, actorId: 5, actorName: 'Speronis-Stonevale-EU', kind: 'support_given', amount: 37_293_624, support: 0, overheal: 0, hits: 700, crits: 0, maxHit: 0, ticks: 0 },
      ],
      supportByRecipient: [{ player: 4, amount: 13_857_879 }, { player: 3, amount: 8_279_903 }],
      supportReceivedFrom: [],
      supportReceivedByBuff: [],
      supportCreditedByBuff: [{ buffId: 395152, evoker: 5, amount: 50_177_400 }, { buffId: 409311, evoker: 5, amount: 37_293_624 }],
      targets: [{ target: { kind: 'unit', name: "Ula'tek", player: null, units: 1 }, amount: 70000000, absorbed: 0, healAbsorbed: 0, hits: 10, crits: 2 }, { target: { kind: 'unit', name: "Venomous Heart", player: null, units: 1 }, amount: 55289517, absorbed: 0, healAbsorbed: 0, hits: 10, crits: 2 }],
      groupAbilities: [{ group: "Ula'tek", abilities: [{ spellId: 395152, amount: 30_000_000 }, { spellId: 44425, amount: 20_000_000 }] }, { group: "Venomous Heart", abilities: [{ spellId: 409311, amount: 20_000_000 }] }],
    },
    {
      player: 4, own: 117_091_704, supportReceived: 13_857_879, supportGiven: 0, supportSelf: 0, total: 103_233_825, perSecond: 215_691, share: 0.278,
      abilities: [
        { spellId: 44425, actorId: 4, actorName: 'Faelan-Emberfall-EU', kind: 'own', amount: 103_233_825, support: 13_857_879, overheal: 0, hits: 300, crits: 120, maxHit: 1_056_506, ticks: 0 },
      ],
      supportByRecipient: [],
      supportReceivedFrom: [{ player: 5, amount: 13_857_879 }],
      supportReceivedByBuff: [{ buffId: 409311, evoker: 5, amount: 13_857_879 }],
      supportCreditedByBuff: [],
      targets: [{ target: { kind: 'unit', name: "Ula'tek", player: null, units: 1 }, amount: 37707419, absorbed: 0, healAbsorbed: 0, hits: 10, crits: 2 }, { target: { kind: 'unit', name: "Blightscale Rawling", player: null, units: 58 }, amount: 23898721, absorbed: 0, healAbsorbed: 0, hits: 10, crits: 2 }, { target: { kind: 'unit', name: "Venomous Heart", player: null, units: 1 }, amount: 22063115, absorbed: 0, healAbsorbed: 0, hits: 10, crits: 2 }, { target: { kind: 'unit', name: "Weakened Doomscale", player: null, units: 2 }, amount: 7038346, absorbed: 0, healAbsorbed: 0, hits: 10, crits: 2 }, { target: { kind: 'unit', name: "Doomscale Warden", player: null, units: 2 }, amount: 4859280, absorbed: 0, healAbsorbed: 0, hits: 10, crits: 2 }, { target: { kind: 'unit', name: "Gore Rattle", player: null, units: 2 }, amount: 3290324, absorbed: 0, healAbsorbed: 0, hits: 10, crits: 2 }, { target: { kind: 'unit', name: "Blightscale Clutch", player: null, units: 16 }, amount: 4376620, absorbed: 0, healAbsorbed: 0, hits: 10, crits: 2 }],
      groupAbilities: [{ group: "Blightscale Rawling", abilities: [{ spellId: 44425, amount: 15_000_000 }] }, { group: "Ula'tek", abilities: [{ spellId: 44425, amount: 30_000_000 }] }, { group: "Venomous Heart", abilities: [{ spellId: 44425, amount: 12_000_000 }] }],
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
      abilities: [{ spellId: 774, actorId: 2, actorName: 'Pyrrin-Emberfall-EU', kind: 'own', amount: 55_000_000, support: 0, overheal: 40_000_000, hits: 2_000, crits: 300, maxHit: 120_000, ticks: 1_900 }],
      supportByRecipient: [],
      supportReceivedFrom: [],
      supportReceivedByBuff: [],
      supportCreditedByBuff: [],
      targets: [{ target: { kind: 'player', name: '', player: 3, units: 0 }, amount: 30000000, absorbed: 0, healAbsorbed: 0, hits: 20, crits: 4 }, { target: { kind: 'player', name: '', player: 4, units: 0 }, amount: 20000000, absorbed: 0, healAbsorbed: 0, hits: 20, crits: 4 }, { target: { kind: 'player', name: '', player: 2, units: 0 }, amount: 10000000, absorbed: 0, healAbsorbed: 0, hits: 20, crits: 4 }],
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

const faelanRow: PlayerAbility = {
  spellId: 0,
  actorId: 4,
  actorName: 'Faelan-Emberfall-EU',
  kind: 'own',
  amount: 0,
  support: 0,
  overheal: 0,
  hits: 0,
  crits: 0,
  maxHit: 0,
  ticks: 0,
  casts: null,
  aug: false,
  pets: 0,
  supportFrom: [],
  recipients: [],
  targets: [],
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
    { ...faelanRow, spellId: 5143, amount: 37_985_527, hits: 1_325, crits: 340, maxHit: 242_663, casts: 85 },
    {
      ...faelanRow,
      spellId: 44425,
      amount: 22_487_648,
      support: 5_978_978,
      hits: 117,
      crits: 47,
      maxHit: 1_056_506,
      casts: 67,
      supportFrom: [
        { buffId: 409311, evoker: 5, amount: 3_978_978 },
        { buffId: 395152, evoker: 5, amount: 2_000_000 },
      ],
      targets: [{ target: { kind: 'unit', name: "Ula'tek", player: null, units: 1 }, amount: 12_000_000, absorbed: 0, healAbsorbed: 0, hits: 60, crits: 24 }, { target: { kind: 'unit', name: "Blightscale Rawling", player: null, units: 58 }, amount: 8_000_000, absorbed: 0, healAbsorbed: 0, hits: 40, crits: 16 }, { target: { kind: 'unit', name: "Doomscale Warden", player: null, units: 2 }, amount: 2_487_648, absorbed: 0, healAbsorbed: 0, hits: 17, crits: 7 }],
    },
    { ...faelanRow, spellId: 404908, amount: 4_369_588, hits: 69, maxHit: 1_857_443, aug: true },
    { ...faelanRow, spellId: 88084, actorId: 40, actorName: 'Mirror Image', kind: 'pet', amount: 1_319_969, hits: 120, crits: 20, maxHit: 30_000, pets: 2 },
    { ...faelanRow, spellId: 0, actorId: 0, actorName: '', kind: 'unmatched', amount: -12_000, support: 12_000, supportFrom: [{ buffId: 395152, evoker: 5, amount: 12_000 }], targets: [{ target: { kind: 'unit', name: "Ula'tek", player: null, units: 1 }, amount: -12_000, absorbed: 0, healAbsorbed: 0, hits: 3, crits: 0 }] },
  ],
  petAbilities: [
    { ...faelanRow, spellId: 59638, actorId: 40, actorName: 'Mirror Image', kind: 'pet', amount: 1_000_000, hits: 100, crits: 15, maxHit: 30_000 },
    { ...faelanRow, spellId: 449569, actorId: 41, actorName: 'Arcane Phoenix', kind: 'pet', amount: 319_969, hits: 20, crits: 5, maxHit: 25_000 },
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
  targets: [{ target: { kind: 'unit', name: "Ula'tek", player: null, units: 1 }, amount: 37707419, absorbed: 0, healAbsorbed: 0, hits: 10, crits: 2 }, { target: { kind: 'unit', name: "Blightscale Rawling", player: null, units: 58 }, amount: 23898721, absorbed: 0, healAbsorbed: 0, hits: 10, crits: 2 }, { target: { kind: 'unit', name: "Venomous Heart", player: null, units: 1 }, amount: 22063115, absorbed: 0, healAbsorbed: 0, hits: 10, crits: 2 }, { target: { kind: 'unit', name: "Doomscale Warden", player: null, units: 2 }, amount: -16914, absorbed: 0, healAbsorbed: 0, hits: 10, crits: 2 }],
  colorGroups: ["Ula'tek", 'Venomous Heart', 'Blightscale Rawling', 'Weakened Doomscale'],
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

const playerKey = (actorId: number) => ({ kind: 'unit' as const, unit: { kind: 'player' as const, actorId } });
const spellKey = (name: string) => ({ kind: 'ability' as const, ability: { kind: 'name' as const, name }, rowKind: 'own' as const, pet: null });
const castRow = (key: ReturnType<typeof playerKey> | ReturnType<typeof spellKey>, name: string, spellId: number, amount: number, total: number) => ({
  key,
  name,
  number: null,
  spellId,
  amount,
  share: amount / total,
  absorbed: 0,
  healAbsorbed: 0,
  hits: amount,
  crits: 0,
  casts: 0,
  hitAmount: 0,
  ticks: 0,
  tickAmount: 0,
  misses: [],
  pets: [],
});

/** Two minutes of casts with Hide procs on: Pyrrin's 50 Soul Fragment procs are left out. */
export const castsReportFixture: CastsReport = {
  breakdown: {
    group: 'source',
    side: ['ability'],
    total: 76,
    durationMs: 120_000,
    perSecond: 76 / 120,
    roster: [roster[1], roster[3]],
    rows: [
      {
        ...castRow(playerKey(4), 'Faelan', 0, 40, 76),
        perSecond: 40 / 120,
        splits: [{ dimension: 'ability', rows: [castRow(spellKey('Arcane Barrage'), 'Arcane Barrage', 44425, 40, 40)] }],
      },
      {
        ...castRow(playerKey(2), 'Pyrrin', 0, 36, 76),
        perSecond: 36 / 120,
        splits: [
          {
            dimension: 'ability',
            rows: [castRow(spellKey('Rejuvenation'), 'Rejuvenation', 774, 30, 36), castRow(spellKey('Regrowth'), 'Regrowth', 8936, 6, 36)],
          },
        ],
      },
    ],
  },
  extras: [
    { player: 2, ability: { kind: 'name', name: 'Regrowth' }, procTrigger: false, spellId: 8936, casts: 6, firstCastMs: 500, uptime: null, link: null },
    { player: 2, ability: { kind: 'name', name: 'Rejuvenation' }, procTrigger: false, spellId: 774, casts: 30, firstCastMs: 1_000, uptime: 0.8, link: { spellId: 774, metric: 'healing' } },
    { player: 4, ability: { kind: 'name', name: 'Arcane Barrage' }, procTrigger: false, spellId: 44425, casts: 40, firstCastMs: 0, uptime: null, link: { spellId: 44425, metric: 'damage' } },
  ],
};

const faelanHolder = { name: 'Faelan-Emberfall-EU', player: 4 };
const wendelHolder = { name: 'Wendel-Emberfall-EU', player: 3 };
const lane = (holder: AuraLane['holder'], spellId: number, sources: number[], applications: number, uptime: number, intervals: [number, number][]): AuraLane => ({
  holder,
  spellId,
  spellIds: [spellId],
  sources,
  applications,
  uptime,
  intervals,
});
const auraRow = (name: string, spellId: number, sources: number[], uptime: number, lanes: AuraLane[]): AuraRow => ({
  key: spellKey(name),
  name,
  spellId,
  spellIds: [spellId],
  holder: null,
  sources,
  applications: lanes.reduce((sum, l) => sum + l.applications, 0),
  uptime,
  lanes,
});

/** Buffs on players by aura. */
export const aurasReportFixture: AurasReport = {
  group: 'ability',
  startMs: 0,
  endMs: 20_000,
  roster,
  spells: { ...spells, '10060': { name: 'Power Infusion' }, '1459': { name: 'Arcane Intellect' }, '2825': { name: 'Bloodlust' } },
  rows: [
    auraRow('Arcane Intellect', 1459, [4], 1, [lane(faelanHolder, 1459, [4], 2, 1, [[0, 20_000]]), lane(wendelHolder, 1459, [4], 2, 1, [[0, 20_000]])]),
    auraRow('Bloodlust', 2825, [], 0.4, [lane(faelanHolder, 2825, [], 1, 0.4, [[2_000, 10_000]]), lane(wendelHolder, 2825, [], 1, 0.4, [[2_000, 10_000]])]),
    auraRow('Power Infusion', 10060, [2], 0.75, [lane(faelanHolder, 10060, [2], 1, 0.75, [[5_000, 20_000]])]),
  ],
  ebonMight: null,
  players: 2,
};

const reportPlayer = (actorId: number, name: string): ReportUnit => ({ unit: { kind: 'player', actorId }, name, number: null });
const ulatek: ReportUnit = { unit: { kind: 'unit', name: "Ula'tek" }, name: "Ula'tek", number: null };
const kickRow = (actorId: number, name: string, interrupts: number, dispels: number) => ({ key: playerKey(actorId), name, number: null, spellId: 0, interrupts, dispels });

export const interruptsReportFixture: InterruptsReport = {
  group: 'source',
  rows: [kickRow(4, 'Faelan', 1, 0), kickRow(3, 'Wendel', 1, 0), kickRow(2, 'Pyrrin', 0, 1)],
  roster,
  spells: { ...spells, '2139': { name: 'Counterspell' }, '6552': { name: 'Pummel' }, '527': { name: 'Purify' }, '5': { name: 'Venom Bolt' }, '9': { name: 'Toxic Spores' } },
  interrupts: [
    { t: 12_000, source: reportPlayer(4, 'Faelan'), spellId: 2139, target: ulatek, interruptedId: 5 },
    { t: 30_000, source: reportPlayer(3, 'Wendel'), spellId: 6552, target: ulatek, interruptedId: 5 },
  ],
  dispels: [{ t: 20_000, source: reportPlayer(2, 'Pyrrin'), spellId: 527, target: reportPlayer(3, 'Wendel'), removedId: 9, stolen: false }],
  missed: [{ t: 45_000, source: ulatek, spellId: 5 }],
  mostInterrupted: { spellId: 5, count: 2 },
  kickers: 2,
  dispellers: 1,
};

export const resourcesReportFixture: ResourcesReport = {
  startMs: 0,
  endMs: 15_000,
  stepMs: 5_000,
  roster,
  spells: { ...spells, '12051': { name: 'Evocation' } },
  units: [
    {
      unit: reportPlayer(4, 'Faelan'),
      boss: false,
      dead: [[5_000, 10_000]],
      tracks: [
        {
          powerType: 0,
          series: [50, 100, 80],
          avgPct: 82.5,
          minPct: 50,
          cappedMs: 10_000,
          gained: 50_000,
          wasted: 10_000,
          gains: [{ spellId: 12051, gained: 50_000, wasted: 10_000 }],
        },
        { powerType: 16, series: [25, 100, null], avgPct: 62.5, minPct: 25, cappedMs: 5_000, gained: 0, wasted: 0, gains: [] },
      ],
    },
    {
      unit: reportPlayer(3, 'Wendel'),
      boss: false,
      dead: [],
      tracks: [{ powerType: 1, series: [0, 40, 10], avgPct: 16.7, minPct: 0, cappedMs: 0, gained: 300, wasted: 20, gains: [] }],
    },
  ],
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
  windowStartMs: 236_000,
  windowFromFullHp: true,
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
  kills: [],
  mostLethal: { spellId: 1302982, environmental: false, count: 1 },
  rezzed: 1,
  deadUnits: 1,
  deadMs: 20_448,
  topKiller: null,
  avgAliveMs: null,
};

export const deathsReportFixture: DeathsReport = recapFixture;

export const breakdownFixture: Breakdown = {
  group: 'source',
  side: ['ability', 'target'],
  total: 3_000_000,
  durationMs: 10_000,
  perSecond: 300_000,
  roster: damageReportFixture.roster,
  rows: [
    {
      key: { kind: 'unit', unit: { kind: 'player', actorId: 3 } },
      name: 'Wendel', number: null, spellId: 0, amount: 2_000_000, share: 2 / 3, absorbed: 250_000, healAbsorbed: 0, hits: 10, crits: 3, casts: 0, hitAmount: 0, ticks: 0, tickAmount: 0, misses: [], pets: [], perSecond: 200_000,
      splits: [
        { dimension: 'ability', rows: [{ key: { kind: 'ability', ability: { kind: 'name', name: 'Mortal Strike' }, rowKind: 'own', pet: null }, name: 'Mortal Strike', number: null, spellId: 12294, amount: 2_000_000, share: 1, absorbed: 0, healAbsorbed: 0, hits: 10, crits: 3, casts: 0, hitAmount: 0, ticks: 0, tickAmount: 0, misses: [], pets: [] }] },
        { dimension: 'target', rows: [{ key: { kind: 'unit', unit: { kind: 'unit', name: "Ula'tek" } }, name: "Ula'tek", number: null, spellId: 0, amount: 2_000_000, share: 1, absorbed: 0, healAbsorbed: 0, hits: 10, crits: 3, casts: 0, hitAmount: 0, ticks: 0, tickAmount: 0, misses: [], pets: [] }] },
      ],
    },
    {
      key: { kind: 'unit', unit: { kind: 'player', actorId: 5 } },
      name: 'Speronis', number: null, spellId: 0, amount: 1_000_000, share: 1 / 3, absorbed: 0, healAbsorbed: 0, hits: 5, crits: 1, casts: 0, hitAmount: 0, ticks: 0, tickAmount: 0, misses: [], pets: [], perSecond: 100_000,
      splits: [
        { dimension: 'ability', rows: [{ key: { kind: 'ability', ability: { kind: 'name', name: 'Ebon Might' }, rowKind: 'support', pet: null }, name: 'Ebon Might', number: null, spellId: 395152, amount: 1_000_000, share: 1, absorbed: 0, healAbsorbed: 0, hits: 0, crits: 0, casts: 0, hitAmount: 0, ticks: 0, tickAmount: 0, misses: [], pets: [] }] },
        { dimension: 'target', rows: [{ key: { kind: 'unit', unit: { kind: 'unit', name: "Ula'tek" } }, name: "Ula'tek", number: null, spellId: 0, amount: 1_000_000, share: 1, absorbed: 0, healAbsorbed: 0, hits: 5, crits: 1, casts: 0, hitAmount: 0, ticks: 0, tickAmount: 0, misses: [], pets: [] }] },
      ],
    },
  ],
};
