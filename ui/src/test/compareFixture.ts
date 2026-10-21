import type { FightRow, LogView, Outcome, PullComparison, QuickOverview } from '../api/types';
import { overviewFixture } from './overviewFixture';

const [edrin, pyrrin, wendel, faelan] = overviewFixture.players;
const spero = { actorId: 5, name: 'Speronis-Stonevale-EU', specId: 1473, specName: 'Augmentation Evoker', classId: 13, classToken: 'EVOKER', role: 'damage' as const };

/** Pull 1: a 2:22 wipe at 60.4 %; Wendel died to world damage at 0:47. */
const wipeOverview: QuickOverview = {
  ...overviewFixture,
  kpis: {
    players: 4,
    durationMs: 142_550,
    raidDamage: 278_300_000,
    raidDps: 1_952_300,
    deaths: 1,
    firstDeathMs: 47_400,
    combatPotions: 3,
    playersWithoutCombatPotion: 1,
    healthstones: 1,
    healthPotions: 0,
  },
  timeline: {
    durationMs: 142_550,
    cutoffMs: null,
    markers: { deaths: [{ t: 47_400, player: 3 }], bloodlust: [], bossCasts: [] },
    bossHpStepMs: 60_000,
    bossHp: [99, 80, 60.4],
    dpsStepMs: 60_000,
    raidDps: [2_000_000, 2_500_000, 1_000_000],
    phases: [{ kind: 'boss', number: 1, startMs: 0, endMs: 142_550, name: null }],
  },
  players: [pyrrin, wendel, faelan, spero],
  deaths: [
    {
      ...overviewFixture.deaths[0],
      t: 47_400,
      killingBlow: { t: 47_350, spellId: 0, sourceName: null, amount: 1_200_000, overkill: 300_000, environmental: true, periodic: false },
    },
  ],
  consumables: [],
  cooldowns: [],
};

/** Pull 1 (the wipe) against pull 3 (the kill in `overviewFixture`). */
export const comparisonFixture: PullComparison = {
  a: { fightIndex: 1, overview: wipeOverview },
  b: { fightIndex: 3, overview: overviewFixture },
  players: [
    { player: faelan, a: { actorId: 4, dps: 300_000, hps: 0, deaths: 0 }, b: { actorId: 4, dps: 420_000, hps: 0, deaths: 1 }, dpsDelta: 120_000 },
    { player: wendel, a: { actorId: 3, dps: 280_000, hps: 0, deaths: 1 }, b: { actorId: 3, dps: 250_000, hps: 0, deaths: 1 }, dpsDelta: -30_000 },
    { player: pyrrin, a: { actorId: 2, dps: 50_000, hps: 210_000, deaths: 0 }, b: { actorId: 2, dps: 40_000, hps: 250_000, deaths: 0 }, dpsDelta: -10_000 },
    { player: spero, a: { actorId: 5, dps: 200_000, hps: 0, deaths: 0 }, b: null, dpsDelta: null },
    { player: edrin, a: null, b: { actorId: 1, dps: 150_000, hps: 0, deaths: 0 }, dpsDelta: null },
  ],
};

function pull(index: number, outcome: Outcome, durationMs: number, bossHpPercent: number | null): FightRow {
  return {
    index,
    encounterId: 3492,
    name: "Ula'tek",
    difficulty: 15,
    difficultyLabel: 'Heroic',
    outcome,
    durationMs,
    bossHpPercent,
    playerCount: 4,
    startUnixMs: Date.UTC(2026, 9, 7, 19, index * 10),
    zone: 'The Venomous Abyss',
    run: null,
    runIndex: null,
  };
}

/** Ula'tek Heroic: a wipe, an aborted pull and the kill. */
export const compareLogFixture: LogView = {
  id: 'WoWCombatLog-100726_185823.txt',
  fileName: 'WoWCombatLog-100726_185823.txt',
  sizeBytes: 230_331_451,
  cacheHit: true,
  logVersion: 22,
  build: '12.1.0',
  advancedLogging: true,
  brokenLines: 0,
  warnings: [],
  zone: 'The Venomous Abyss',
  startUnixMs: Date.UTC(2026, 9, 7, 19, 10),
  fights: [pull(1, 'wipe', 142_550, 60.4), pull(2, 'wipe', 19, null), pull(3, 'kill', 478_610, 0)],
};
