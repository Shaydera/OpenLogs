import type { ReplayData } from '../api/types';

/** A made-up five-minute pull with three players, a pet, a boss and two adds of one name. */
export const replayFixture: ReplayData = {
  encounterId: 9001,
  advancedLogging: true,
  durationMs: 300_000,
  roster: [
    { actorId: 1, name: 'Talwyn-Emberfall-EU', specId: 66, specName: 'Protection Paladin', classId: 2, classToken: 'PALADIN', role: 'tank' },
    { actorId: 2, name: 'Miravel-Emberfall-EU', specId: 257, specName: 'Holy Priest', classId: 5, classToken: 'PRIEST', role: 'healer' },
    { actorId: 3, name: 'Orsek-Emberfall-EU', specId: 253, specName: 'Beast Mastery Hunter', classId: 3, classToken: 'HUNTER', role: 'damage' },
  ],
  spells: {},
  units: [
    { actor: 1, name: 'Talwyn-Emberfall-EU', kind: 'player', specId: 66, classId: 2, owner: null, addNumber: null },
    { actor: 2, name: 'Miravel-Emberfall-EU', kind: 'player', specId: 257, classId: 5, owner: null, addNumber: null },
    { actor: 3, name: 'Orsek-Emberfall-EU', kind: 'player', specId: 253, classId: 3, owner: null, addNumber: null },
    { actor: 4, name: 'Bristlemane', kind: 'pet', specId: null, classId: null, owner: 3, addNumber: null },
    { actor: 10, name: 'Gorvath the Hollow', kind: 'boss', specId: null, classId: null, owner: null, addNumber: null },
    { actor: 11, name: 'Ashen Husk', kind: 'add', specId: null, classId: null, owner: null, addNumber: 1 },
    { actor: 12, name: 'Ashen Husk', kind: 'add', specId: null, classId: null, owner: null, addNumber: 2 },
  ],
  tracks: [
    { actor: 1, t: [0, 1_000], x: [100, 101], y: [200, 201], facing: [0, 0], map: [2001, 2001] },
    { actor: 10, t: [0, 1_000], x: [105, 105], y: [205, 205], facing: [0, 0], map: [2001, 2001] },
  ],
  health: [],
  power: [],
  targets: [],
  casts: [],
  auras: [],
  raidMarkers: [],
  worldMarkers: [],
  effects: [],
  phases: [
    { kind: 'boss', number: 1, startMs: 0, endMs: 150_000, name: null },
    { kind: 'intermission', number: 1, startMs: 150_000, endMs: 180_000, name: null },
    { kind: 'boss', number: 2, startMs: 180_000, endMs: 300_000, name: null },
  ],
  deaths: [{ actor: 3, t: 194_000, until: null }],
  maps: [],
  arenaFrame: null,
};
