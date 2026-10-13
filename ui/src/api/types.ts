/** Mirrors the DTOs of `crates/openlogs-service` (serde camelCase). Times are zone-less log wall-clock values sent as Unix ms. */
export type Outcome = 'kill' | 'wipe' | 'incomplete';
export type Role = 'tank' | 'healer' | 'damage';

/** Bosses of the dungeon killed in a run (mirrors `BossProgressDto`). */
export interface BossProgress {
  killed: number;
  total: number;
}

/** A completed key against its time limits (mirrors `TimerDto`). */
export type KeyTimer = { kind: 'inTime'; upgrades: number } | { kind: 'overTime' };

/** Mythic+ details of a run row (mirrors `RunDto`). */
export interface RunInfo {
  challengeModeId: number;
  keystoneLevel: number;
  /** Affix IDs as logged; shown raw until curated names exist. */
  affixIds: number[];
  /** Time from `CHALLENGE_MODE_END`; `null` without an end. */
  totalTimeMs: number | null;
  /** Bosses killed of the dungeon's boss list; `null` without dungeon data for the key. */
  bosses: BossProgress | null;
  /** Only when the dungeon data shows the run completed and the log has its time. */
  timer: KeyTimer | null;
}

/** A boss pull, or a whole Mythic+ run when `run` is set; both open by `index`. */
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
  /** Set when this row is a whole Mythic+ run; its boss pulls are rows of their own. */
  run: RunInfo | null;
  /** Log index of the run this boss pull belongs to. */
  runIndex: number | null;
}

export interface LogView {
  /** Identifies the log across sessions: its file name. */
  id: string;
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
  id: string;
  fileName: string;
  sizeBytes: number;
  zone: string | null;
  startUnixMs: number | null;
  pullCount: number;
  openedAtUnixMs: number;
  /** False when the browser cannot open the log again without the user choosing its file. */
  exists: boolean;
}

export type ConsumableKind = 'combat_potion' | 'health_potion' | 'healthstone' | 'mana_potion';
export type CooldownCategory = 'offensive' | 'raid_defensive' | 'bloodlust';

export interface Kpis {
  players: number;
  durationMs: number;
  raidDamage: number;
  raidDps: number;
  deaths: number;
  firstDeathMs: number | null;
  combatPotions: number;
  playersWithoutCombatPotion: number;
  healthstones: number;
  healthPotions: number;
}

export interface Phase {
  /** `trash`: time between the boss pulls of a Mythic+ run. */
  kind: 'boss' | 'intermission' | 'trash';
  number: number;
  startMs: number;
  endMs: number;
  /** From a phase config or a run's boss; `null` for detected phases and trash. */
  name: string | null;
}

export interface TimelineMarkers {
  deaths: { t: number; player: number }[];
  bloodlust: { t: number; player: number; spellId: number }[];
  bossCasts: { t: number; spellId: number }[];
}

export interface OverviewTimeline {
  /** The whole pull, whatever the range. */
  durationMs: number;
  /** Whole-pull markers. */
  markers: TimelineMarkers;
  bossHpStepMs: number;
  /** Boss HP percent per step; `null` where the boss reported nothing (intermissions). */
  bossHp: (number | null)[];
  dpsStepMs: number;
  raidDps: number[];
  phases: Phase[];
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

export interface Hit {
  t: number;
  /** 0 = melee. */
  spellId: number;
  sourceName: string | null;
  amount: number;
  overkill: number;
  /** Falling, lava, drowning and other world damage. */
  environmental: boolean;
  /** A damage-over-time tick: a source-less one is a debuff whose caster is gone ("Debuff"). */
  periodic: boolean;
}

/** A death-context entry: a personal defensive, the healthstone, the health potion, or the combat potion while its cooldown runs. */
export type ContextItem = 'healthstone' | 'health_potion' | 'combat_potion' | 'defensive';
/** `never_used`: a defensive not used once before the death although it would have been ready again. */
export type ContextState = 'used' | 'on_cooldown' | 'available' | 'never_used';

export interface ContextEntry {
  item: ContextItem;
  /** The stone or potion used, else the item's representative spell; the defensive's spell. */
  spellId: number;
  state: ContextState;
  /** Time of the use for `used` and `on_cooldown`. */
  t: number | null;
}

export interface DeathEntry {
  player: number;
  playerName: string;
  /** Milliseconds since the pull started. */
  t: number;
  killingBlow: Hit | null;
  damageLast5s: { spellId: number; amount: number; environmental: boolean }[];
  damageTaken5s: number;
  healingTaken5s: number;
  hpBeforePct: number | null;
  resurrectedAt: number | null;
  context: ContextEntry[];
}

export interface ConsumableEntry {
  player: number;
  t: number;
  spellId: number;
  kind: ConsumableKind;
}

export interface CooldownEntry {
  player: number;
  t: number;
  spellId: number;
  category: CooldownCategory;
  durationMs: number;
}

/** Mirrors `crates/openlogs-service/src/overview_dto.rs`. */
export interface QuickOverview {
  kpis: Kpis;
  timeline: OverviewTimeline;
  players: PlayerRef[];
  /** Spell names by ID (JSON object keys are strings). */
  spells: Record<string, { name: string }>;
  deaths: DeathEntry[];
  consumables: ConsumableEntry[];
  cooldowns: CooldownEntry[];
}

/** Mirrors `crates/openlogs-service/src/compare_dto.rs`. */
export interface PlayerSide {
  /** The player's actor in that pull; ids differ between pulls. */
  actorId: number;
  dps: number;
  hps: number;
  deaths: number;
}

export interface ComparedPlayer {
  /** Name, class, spec and role; its `actorId` belongs to the pull that named the player. */
  player: PlayerRef;
  /** `null` when the player was not in that pull. */
  a: PlayerSide | null;
  b: PlayerSide | null;
  /** DPS in B minus DPS in A; `null` unless the player was in both pulls. */
  dpsDelta: number | null;
}

export interface PullSide {
  fightIndex: number;
  /** The whole pull. */
  overview: QuickOverview;
}

export interface PullComparison {
  /** The earlier pull. */
  a: PullSide;
  /** The later pull. */
  b: PullSide;
  /** Players of both pulls by |DPS difference|, then players of one pull by DPS. */
  players: ComparedPlayer[];
}

export type Attribution = 'augmented' | 'reattributed';

export interface ReportFilter {
  /** ms since the pull started; `null` = from the start / to the end. */
  startMs: number | null;
  endMs: number | null;
  attribution: Attribution;
}

/** `unmatched`: Reattributed support from hits no ability could be matched to. */
export type RowKind = 'own' | 'pet' | 'support_given' | 'unmatched';

export interface AbilityRow {
  spellId: number;
  actorId: number;
  /** Pet name for pet rows, the Evoker for support rows. */
  actorName: string;
  kind: RowKind;
  /** Reattributed mode: net of `support` (negative for the unmatched row). */
  amount: number;
  /** Reattributed mode: the part of the logged amount that moved to Evokers. */
  support: number;
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

/** Whom an amount went to: an enemy (or friendly NPC) by name, a player of the roster, or an unnamed unit. */
export interface TargetRef {
  kind: 'unit' | 'player' | 'unknown';
  /** The unit's name; empty for players and unknown units. */
  name: string;
  player: number | null;
  /** Units of this name that took damage in the range; 0 when not counted. */
  units: number;
}

export interface TargetShare {
  target: TargetRef;
  /** Net of Aug support in Reattributed mode. */
  amount: number;
  hits: number;
  crits: number;
}

/** A player's largest abilities on one colour group (`group`: its enemy name, `null` for "Other"). */
export interface GroupAbilities {
  group: string | null;
  abilities: { spellId: number; amount: number }[];
}

/** Support of one Evoker's buff ("Ebon Might · Speronis"). */
export interface BuffShare {
  buffId: number;
  evoker: number;
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
  supportReceivedByBuff: BuffShare[];
  /** What the player's buffs added (own share included), by buff. */
  supportCreditedByBuff: BuffShare[];
  targets: TargetShare[];
  groupAbilities: GroupAbilities[];
}

export interface DamageReport extends ReportBase {
  players: PlayerDamage[];
  /** The raid's largest enemy groups in the range, largest first: the bars' colours. */
  colorGroups: string[];
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
  supportReceivedByBuff: BuffShare[];
  /** What the player's buffs added (own share included), by buff. */
  supportCreditedByBuff: BuffShare[];
  targets: TargetShare[];
}

export interface HealingReport extends ReportBase {
  overheal: number;
  players: PlayerHealing[];
}

/** A spell in a damage-taken summary; world damage is kept apart from melee (both spell 0). */
export interface TakenSpell extends SpellAmount {
  environmental: boolean;
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

export type Metric = 'damage' | 'healing';

/** A buff row's kind; also its colour on the player page. */
export type BuffKind = 'aug' | 'lust' | 'external' | 'cooldown' | 'proc' | 'shield' | 'defensive';

/** A cast row's group: major cooldown, rotation (curated, or the most-cast spells of a spec without curated rows) or defensive. */
export type CastKind = 'major' | 'rotation' | 'defensive';

export interface PlayerDeath {
  t: number;
  resurrectedAt: number | null;
  killingBlow: Hit | null;
  /** The res spell; `source` is the caster when it is a player in `roster`. */
  resurrectedBy: { spellId: number; source: number | null } | null;
  /** The killing blow's spell hitting in a row before the death. */
  lethalBurst: { spellId: number; count: number; windowMs: number } | null;
  /** Defensives and consumables at the moment of death (as on the Overview). */
  context: ContextEntry[];
}

export interface PlayerAbility extends AbilityRow {
  /** The player's own casts of a spell of this name; `null` without casts and for pet and support rows. */
  casts: number | null;
  /** Created by an Evoker's buff and also logged as support (Fate Mirror, Breath of Eons). */
  aug: boolean;
  /** Pet names merged into the pet row; 0 for other rows. */
  pets: number;
  /** Reattributed mode: the row's `support` by buff and Evoker. */
  supportFrom: BuffShare[];
  /** Reattributed mode, an Evoker's support rows: the players the buff supported. */
  recipients: SupportRecipient[];
  /** The row by target, largest first. */
  targets: TargetShare[];
}

export interface SupportRecipient {
  player: number;
  amount: number;
  abilities: SupportedAbility[];
}

export interface SupportedAbility {
  /** `null` for hits no ability could be matched to. */
  spellId: number | null;
  /** The pet's name when a pet cast it. */
  petName: string | null;
  amount: number;
}

export interface SpellAmount {
  spellId: number;
  amount: number;
}

export interface PlayerDetail {
  player: PlayerRef;
  specName: string | null;
  itemLevel: number | null;
  maxHp: number | null;
  metric: Metric;
  /** The Aug mode this page was computed with. */
  attribution: Attribution;
  /** The range clipped to the pull. */
  startMs: number;
  endMs: number;
  total: number;
  otherModeTotal: number;
  perSecond: number;
  /** 1-based; 0 = not ranked. */
  rank: number;
  rankedPlayers: number;
  supportReceived: number;
  supportReceivedFrom: PlayerAmount[];
  /** Whom the player damaged or healed, largest first. */
  targets: TargetShare[];
  /** The raid's largest enemy groups in the range (damage only): the bars' colours. */
  colorGroups: string[];
  healingReceived: number;
  deaths: PlayerDeath[];
  consumables: { t: number; spellId: number; kind: ConsumableKind }[];
  abilities: PlayerAbility[];
  /** The pet row's parts: every pet ability by pet name, largest first (the expanded pet row). */
  petAbilities: PlayerAbility[];
  takenBySpell: TakenSpell[];
  seriesStepMs: number;
  series: number[];
  castRows: { spellId: number; kind: CastKind; durationMs: number; times: number[]; link: AbilityLink | null }[];
  /** The player's own casts, most frequent spells first (at most 12). */
  castTimeline: { spellId: number; kind: CastKind; durationMs: number; times: number[]; link: AbilityLink | null }[];
  buffRows: { spellId: number; source: number; kind: BuffKind; intervals: [number, number][]; uptime: number }[];
  /** Ebon Might on the player from any Evoker, merged and clipped to the range. */
  ebonMight: [number, number][];
  /** Dead phases overlapping the range, clipped to it. */
  dead: [number, number][];
  /** The death time when the player was already dead at the range start. */
  deadSince: number | null;
  /** Evokers only: support and buff uptime per buffed player. */
  augmentation: AugTarget[];
  /** Mana percent per series step; empty without mana data. */
  mana: (number | null)[];
  roster: PlayerRef[];
  spells: Record<string, { name: string }>;
}

export type Detail =
  | { kind: 'player'; player: number }
  /** `spellName`: pinned once the page loaded, so the breadcrumb keeps it while other pages sit above. */
  | { kind: 'ability'; player: number; spellId: number; pet: string | null; spellName?: string }
  | { kind: 'target'; name: string };

export interface AugTarget {
  player: number;
  support: number;
  ebonMightUptime: number;
  prescienceUptime: number;
}

export interface AbilityHit {
  t: number;
  target: number;
  amount: number;
  critical: boolean;
  periodic: boolean;
}

export interface AbilityDetail {
  player: PlayerRef;
  spellId: number;
  spellName: string;
  /** Spell school bit mask. */
  school: number;
  pet: string | null;
  metric: Metric;
  startMs: number;
  endMs: number;
  total: number;
  playerTotal: number;
  casts: number[];
  hits: AbilityHit[];
  byTarget: { name: string; hits: number; crits: number; amount: number }[];
  median: number;
  uptime: number | null;
  dead: [number, number][];
  /** Unit names by actor id (JSON keys are strings). */
  targetNames: Record<string, string>;
  /** Names in `targetNames` that belong to players; only these drop their realm in the UI. */
  playerTargets: string[];
}

export interface UnitLife {
  actor: number;
  firstHit: number;
  lastHit: number;
  death: number | null;
}

export interface TargetDetail {
  name: string;
  startMs: number;
  endMs: number;
  damageTaken: number;
  raidDamage: number;
  maxHp: number | null;
  isBoss: boolean;
  sharesBossHp: boolean;
  /** The encounter's main boss: its portrait belongs here. */
  primary: boolean;
  units: UnitLife[];
  waves: { startMs: number; units: number; killed: number; clearMs: number; avgLifeMs: number | null }[];
  byPlayer: PlayerAmount[];
  enemies: { name: string; units: number; damageTaken: number; isBoss: boolean; sharesBossHp: boolean; primary: boolean }[];
  roster: PlayerRef[];
}

export type RecapKind = 'damage' | 'heal' | 'absorb';

export interface RecapEvent {
  t: number;
  spellId: number;
  sourceName: string | null;
  kind: RecapKind;
  /** Damage incl. shielded part, effective heal, or absorbed amount. */
  amount: number;
  /** Damage only: the shielded part. */
  absorbed: number;
  /** Overkill (damage) or overheal (heals). */
  excess: number;
  hpPct: number | null;
  /** Falling, lava, drowning and other world damage (spell 0, like melee). */
  environmental: boolean;
  /** A damage or heal over time tick. */
  periodic: boolean;
  /** The player behind a pet, guardian or totem source ("Mulgar (Totem)"). */
  sourceOwnerName: string | null;
}

export interface DeathRecap extends DeathEntry {
  /** 1-based number of the death in the pull. */
  number: number;
  /** "Arcane Mage"; `null` without COMBATANT_INFO. */
  specName: string | null;
  /** The res spell; `source` is the caster when it is a player in `roster`. */
  resurrectedBy: PlayerDeath['resurrectedBy'];
  /** The killing blow's spell hitting in a row before the death. */
  lethalBurst: PlayerDeath['lethalBurst'];
  maxHp: number | null;
  /** The last 8 s, oldest first. */
  events: RecapEvent[];
  hp: { t: number; pct: number }[];
  buffs: { spellId: number; sourceName: string | null }[];
}

export interface DeathsReport {
  deaths: DeathRecap[];
  roster: PlayerRef[];
  spells: Record<string, { name: string }>;
}

export interface SpellCasts {
  spellId: number;
  casts: number;
  /** The first cast in the range (ms from the pull); equal counts are ordered by it. */
  firstCastMs: number;
  procTrigger: boolean;
  uptime: number | null;
  /** The ability page with this spell's hits; `null` when it has none. */
  link: AbilityLink | null;
}

/** Where a cast spell's hits are: cast and hit IDs often differ. */
export interface AbilityLink {
  spellId: number;
  metric: Metric;
}

export interface CastsReport {
  durationMs: number;
  players: { player: number; spells: SpellCasts[] }[];
  roster: PlayerRef[];
  spells: Record<string, { name: string }>;
}

export type AuraScope = 'buffs_on_players' | 'debuffs_on_players' | 'debuffs_on_enemies';

export interface AurasReport {
  startMs: number;
  endMs: number;
  rows: {
    spellId: number;
    /** Every spell ID of the row's name (one row per name), `spellId` first. */
    spellIds: number[];
    /** The players who applied it (in `roster`), most applications first. */
    sources: number[];
    applications: number;
    uptime: number;
    targets: { name: string; player: number | null; uptime: number; intervals: [number, number][] }[];
  }[];
  roster: PlayerRef[];
  spells: Record<string, { name: string }>;
}

export interface InterruptsReport {
  interrupts: { t: number; player: number; spellId: number; targetName: string | null; interruptedId: number }[];
  dispels: {
    t: number;
    player: number;
    spellId: number;
    targetName: string | null;
    /** The target when it is a player (in `roster`). */
    target: number | null;
    removedId: number;
    stolen: boolean;
  }[];
  missed: { t: number; sourceName: string | null; spellId: number }[];
  roster: PlayerRef[];
  spells: Record<string, { name: string }>;
}

export interface PowerTrack {
  powerType: number;
  series: (number | null)[];
  avgPct: number | null;
  minPct: number | null;
  cappedMs: number;
  gained: number;
  wasted: number;
  gains: { spellId: number; gained: number; wasted: number }[];
}

export interface ResourcesReport {
  startMs: number;
  endMs: number;
  stepMs: number;
  players: {
    player: number;
    tracks: PowerTrack[];
    /** Dead phases in the range, clipped to it. */
    dead: [number, number][];
  }[];
  roster: PlayerRef[];
  spells: Record<string, { name: string }>;
}
