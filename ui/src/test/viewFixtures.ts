import type { EventRow, EventsPage, PlayerRef, Timeline, UnitInfo } from '../api/types';

const roster: PlayerRef[] = [
  { actorId: 3, name: 'Wendel-Emberfall-EU', specId: 71, specName: 'Arms Warrior', classId: 1, classToken: 'WARRIOR', role: 'damage' },
  { actorId: 4, name: 'Faelan-Emberfall-EU', specId: 62, specName: 'Arcane Mage', classId: 8, classToken: 'MAGE', role: 'damage' },
  { actorId: 5, name: 'Speronis-Stonevale-EU', specId: 1473, specName: 'Augmentation Evoker', classId: 13, classToken: 'EVOKER', role: 'damage' },
];

const units: UnitInfo[] = [
  { actorId: 3, name: 'Wendel', number: null, owner: null, player: true },
  { actorId: 4, name: 'Faelan', number: null, owner: null, player: true },
  { actorId: 5, name: 'Speronis', number: null, owner: null, player: true },
  { actorId: 7, name: 'Wild Imp', number: null, owner: 3, player: false },
  { actorId: 9, name: "Ula'tek", number: 1, owner: null, player: false },
];

const spells = {
  '0': { name: 'Melee' },
  '30451': { name: 'Arcane Blast' },
  '44425': { name: 'Arcane Barrage' },
  '395152': { name: 'Ebon Might' },
  '1766': { name: 'Kick' },
  '1287012': { name: 'Caustic Waves' },
};

const row: Omit<EventRow, 'index' | 't' | 'type' | 'event' | 'source' | 'spellId' | 'target' | 'amount'> = {
  overkill: 0,
  absorbed: 0,
  blocked: 0,
  resisted: 0,
  overheal: 0,
  critical: false,
  targetHp: null,
  shares: [],
  auraKind: null,
  stacks: null,
  used: null,
  durationMs: null,
  stage: null,
  outcome: null,
  reason: null,
  pressMs: null,
  by: null,
  unknownBlow: false,
  environmental: false,
  aliveMs: null,
  contextOf: null,
};

/** Damage Done, Reattributed: the first page of 576 hits; Speronis's Ebon Might rides on two of them. */
export const eventsPageFixture: EventsPage = {
  total: 576,
  offset: 0,
  rows: [
    {
      ...row,
      index: 41_200,
      t: 130_007,
      type: 'damage',
      event: 'SPELL_DAMAGE',
      source: 4,
      spellId: 44425,
      target: 9,
      amount: 1_056_506,
      critical: true,
      targetHp: [951_059_820, 1_268_079_760],
      shares: [{ buffId: 395152, evoker: 5, amount: 62_000, selected: false }],
    },
    {
      ...row,
      index: 41_230,
      t: 130_077,
      type: 'melee',
      event: 'SWING_DAMAGE',
      source: 3,
      spellId: 0,
      target: 9,
      amount: 12_556,
      shares: [{ buffId: 395152, evoker: 5, amount: 280, selected: false }],
    },
    {
      ...row,
      index: 41_240,
      t: 130_100,
      type: 'damage',
      event: 'SPELL_DAMAGE',
      source: 7,
      spellId: 30451,
      target: 9,
      amount: 8_344,
    },
  ],
  narrowed: [],
  amount: 1_076_906,
  unlistedSupport: 0,
  hiddenProcs: 0,
  units,
  roster,
  spells,
};

/** Casts by Source in the window 2:00–2:20 (loaded 1:50–2:30), with a boss cast above the lanes. */
export const timelineFixture: Timeline = {
  startMs: 110_000,
  endMs: 150_000,
  axis: 'source',
  lanes: [
    {
      key: { kind: 'unit', unit: { kind: 'player', actorId: 4 } },
      name: 'Faelan',
      number: null,
      spellId: 0,
      total: 287,
      tracks: 1,
      items: [
        {
          kind: 'castTime',
          startMs: 128_000,
          endMs: 129_200,
          spanEndMs: 129_200,
          source: 4,
          spellId: 30451,
          target: 9,
          amount: { rule: 'untilNextCast', amount: 1_056_506, hits: 1, targets: 1, support: 62_000, healing: false },
          log: [
            { t: 128_000, event: 'SPELL_CAST_START', spellId: 30451 },
            { t: 129_200, event: 'SPELL_CAST_SUCCESS', spellId: 30451 },
          ],
        },
        { kind: 'instant', startMs: 130_000, spanEndMs: 130_000, source: 4, spellId: 44425, target: 9, log: [{ t: 130_000, event: 'SPELL_CAST_SUCCESS', spellId: 44425 }] },
      ],
      power: [],
      dead: [],
      boss: false,
    },
    {
      key: { kind: 'unit', unit: { kind: 'player', actorId: 3 } },
      name: 'Wendel',
      number: null,
      spellId: 0,
      total: 120,
      tracks: 1,
      items: [
        {
          kind: 'interrupted',
          startMs: 133_000,
          endMs: 133_950,
          spanEndMs: 133_950,
          source: 3,
          spellId: 30451,
          target: 9,
          by: { actorId: 9, spellId: 1766 },
          log: [
            { t: 133_000, event: 'SPELL_CAST_START', spellId: 30451 },
            { t: 133_950, event: 'SPELL_INTERRUPT', spellId: 1766 },
          ],
        },
      ],
      power: [],
      dead: [],
      boss: false,
    },
  ],
  context: [
    {
      kind: 'castTime',
      startMs: 125_000,
      endMs: 127_000,
      spanEndMs: 127_000,
      source: 9,
      spellId: 1287012,
      target: 0,
      amount: { rule: 'bossCast', amount: 2_400_000, hits: 12, targets: 6, support: 0, healing: false },
      log: [{ t: 125_000, event: 'SPELL_CAST_START', spellId: 1287012 }],
    },
  ],
  legend: [],
  units,
  roster,
  spells,
  linesListed: true,
  listedWindowMs: 120_000,
};

const aura = (spellId: number, track: number) => ({
  kind: 'aura' as const,
  startMs: 120_000 + track * 1_000,
  endMs: 130_000 + track * 1_000,
  spanEndMs: 130_000 + track * 1_000,
  source: 5,
  spellId,
  target: 4,
  track,
  log: [{ t: 120_000 + track * 1_000, event: 'SPELL_AURA_APPLIED', spellId }],
});

/** Buffs on Faelan, packed into ten sub-tracks. */
export const buffsTimelineFixture: Timeline = {
  ...timelineFixture,
  axis: 'target',
  context: [],
  lanes: [
    {
      key: { kind: 'unit', unit: { kind: 'player', actorId: 4 } },
      name: 'Faelan',
      number: null,
      spellId: 0,
      total: 600_000,
      tracks: 10,
      items: Array.from({ length: 10 }, (_, track) => aura(395152, track)),
      power: [],
      dead: [],
      boss: false,
    },
  ],
};

/** Damage Taken on Wendel: two debuffs of Ula'tek and a death. */
export const takenTimelineFixture: Timeline = {
  ...timelineFixture,
  axis: 'target',
  legend: [1287012, 395152],
  lanes: [
    {
      key: { kind: 'unit', unit: { kind: 'player', actorId: 3 } },
      name: 'Wendel',
      number: null,
      spellId: 0,
      total: 2_400_000,
      tracks: 2,
      items: [
        { ...aura(1287012, 0), source: 9, target: 3, amount: { rule: 'whileUp', amount: 900_000, hits: 3, targets: 1, support: 0, healing: false } },
        { ...aura(395152, 1), source: 9, target: 3 },
        { kind: 'death', startMs: 135_000, spanEndMs: 135_000, source: 0, spellId: 0, target: 3, by: { actorId: 9, spellId: 1287012 }, overkill: 12_000 },
      ],
      power: [],
      dead: [],
      boss: false,
    },
  ],
};

/** Resources of Faelan: mana and health samples as logged, dead from 2:12 to 2:14. */
export const resourcesTimelineFixture: Timeline = {
  ...timelineFixture,
  context: [],
  lanes: [
    {
      key: { kind: 'unit', unit: { kind: 'player', actorId: 4 } },
      name: 'Faelan',
      number: null,
      spellId: 0,
      total: 0,
      tracks: 1,
      items: [],
      power: [
        { powerType: 0, samples: [[118_000, 250_000, 250_000], [125_000, 100_000, 250_000]] },
        { powerType: -2, samples: [[119_000, 1_000_000, 1_000_000], [131_000, 400_000, 1_000_000], [132_000, 0, 1_000_000]] },
      ],
      dead: [[132_000, 134_000]],
      boss: false,
    },
  ],
};
