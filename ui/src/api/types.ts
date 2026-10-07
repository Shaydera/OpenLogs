/** Mirrors `src-tauri/src/dto.rs` (serde camelCase). Times are zone-less log wall-clock values sent as Unix ms. */
export type Outcome = 'kill' | 'wipe' | 'incomplete';
export type Role = 'tank' | 'healer' | 'damage';

export interface FightRow {
  index: number;
  encounterId: number;
  name: string;
  difficulty: number;
  /** `null` for unknown difficulty IDs, which the UI shows raw. */
  difficultyLabel: string | null;
  outcome: Outcome;
  durationMs: number;
  bossHpPercent: number | null;
  playerCount: number;
  startUnixMs: number;
  zone: string | null;
}

export interface LogView {
  path: string;
  fileName: string;
  sizeBytes: number;
  cacheHit: boolean;
  logVersion: number | null;
  build: string | null;
  advancedLogging: boolean;
  brokenLines: number;
  warnings: string[];
  zone: string | null;
  startUnixMs: number | null;
  fights: FightRow[];
}

export interface RecentLog {
  path: string;
  fileName: string;
  sizeBytes: number;
  zone: string | null;
  startUnixMs: number | null;
  pullCount: number;
  openedAtUnixMs: number;
  /** False when the file no longer exists on disk. */
  exists: boolean;
}

export interface Phase {
  kind: 'boss' | 'intermission';
  number: number;
  startMs: number;
  endMs: number;
  /** From a phase config; `null` for detected phases. */
  name: string | null;
}

/** Mirrors `TimelineDto` in `src-tauri/src/report_dto.rs`: the whole pull, whatever the range. */
export interface FightTimeline {
  durationMs: number;
  bossHpStepMs: number;
  /** Boss HP percent per step; `null` where the boss reported nothing (intermissions). */
  bossHp: (number | null)[];
  dpsStepMs: number;
  raidDps: number[];
  phases: Phase[];
  /** When each player death happened. */
  deaths: number[];
}

export interface PlayerRef {
  actorId: number;
  name: string;
  specId: number | null;
  /** E.g. "Arcane Mage"; `null` without a known spec. */
  specName: string | null;
  classId: number | null;
  classToken: string | null;
  role: Role | null;
}

export type Attribution = 'augmented' | 'reattributed';

export interface ReportFilter {
  /** ms since the pull started; `null` = from the start / to the end. */
  startMs: number | null;
  endMs: number | null;
  attribution: Attribution;
}

export type RowKind = 'own' | 'pet' | 'support_given' | 'support_deducted';

export interface AbilityRow {
  spellId: number;
  actorId: number;
  /** Pet name for pet rows, the Evoker for support rows. */
  actorName: string;
  kind: RowKind;
  /** Negative for support deducted from the player. */
  amount: number;
  overheal: number;
  hits: number;
  crits: number;
  /** Largest single positive amount. */
  maxHit: number;
  /** Periodic hits (DoT/HoT ticks). */
  ticks: number;
}

export interface PlayerAmount {
  player: number;
  amount: number;
}

interface ReportBase {
  durationMs: number;
  total: number;
  roster: PlayerRef[];
  spells: Record<string, { name: string }>;
}

export interface PlayerDamage {
  player: number;
  own: number;
  supportReceived: number;
  supportGiven: number;
  /** The Evoker's share inside their own events; counted in both modes. */
  supportSelf: number;
  total: number;
  perSecond: number;
  share: number;
  abilities: AbilityRow[];
  supportByRecipient: PlayerAmount[];
  supportReceivedFrom: PlayerAmount[];
}

export interface DamageReport extends ReportBase {
  players: PlayerDamage[];
}

export interface PlayerHealing {
  player: number;
  healing: number;
  absorbs: number;
  overheal: number;
  supportReceived: number;
  supportGiven: number;
  /** The Evoker's share inside their own events; counted in both modes. */
  supportSelf: number;
  total: number;
  perSecond: number;
  share: number;
  abilities: AbilityRow[];
  supportByRecipient: PlayerAmount[];
  /** Support received, by Evoker. */
  supportReceivedFrom: PlayerAmount[];
}

export interface HealingReport extends ReportBase {
  overheal: number;
  players: PlayerHealing[];
}

export interface TakenAbility {
  spellId: number;
  /** World damage, kept apart from melee (both spell 0). */
  environmental: boolean;
  sourceName: string | null;
  /** The source when it is a player (in the roster); `null` for NPCs, world and source-less damage. */
  sourceId: number | null;
  amount: number;
  absorbed: number;
  hits: number;
  playersHit: number;
}

export interface TakenPlayer {
  player: number;
  amount: number;
  absorbed: number;
  perSecond: number;
  share: number;
  /** The player's damage taken by spell and source, largest first (`playersHit` is 1). */
  abilities: TakenAbility[];
}

export interface DamageTakenReport extends ReportBase {
  byAbility: TakenAbility[];
  byPlayer: TakenPlayer[];
}

/** One downloaded game-data table (mirrors `TableStatusDto`). */
export interface TableStatus {
  /** Entries of the table in use; `null` while the app has none. */
  entries: number | null;
  /** When the stored table was downloaded: a real instant (Unix ms), not a log time. */
  fetchedUnixMs: number | null;
  /** Why the last download failed; `null` after a successful one. */
  error: string | null;
}

/** The Settings dialog's game-data section (mirrors `GameDataStatusDto`). */
export interface GameDataStatus {
  spellIcons: TableStatus;
  bossPortraits: TableStatus;
  /** A sync (app start or "Refresh now") is running. */
  refreshing: boolean;
}
