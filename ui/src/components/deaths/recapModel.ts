import type { ContextEntry, ContextItem, DeathRecap, RecapEvent } from '../../api/types';
import {
  formatAgo,
  formatAmount,
  formatInteger,
  formatList,
  formatOffsetSeconds,
  formatPercent,
  formatSeconds,
  formatSignedInteger,
} from '../../i18n/format';
import { locale, t } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/i18n';
import { shortName, usedAtLabel } from '../overview/players';
import { hitName } from '../reports/reportData';

/** HP curve and event window before a death (matches the backend). */
const RECAP_WINDOW_MS = 8_000;
/** The plot runs this far past the death, so the drop and the death marker sit inside it. */
const RECAP_TAIL_MS = 400;
const RECAP_EVENTS_MS = 3_000;
/** A hit of this share of max HP is a big hit. */
const BIG_HIT_SHARE = 0.1;
/** Big hits without a known max HP. */
const BIG_HIT_FALLBACK = 100_000;

const WIDTH = 1000;
const HEIGHT = 200;

const round1 = (v: number) => Math.round(v * 10) / 10;
/** 100 % at y 10, 0 % at y 195 of 200, so the line never touches the frame. */
const hpY = (pct: number) => round1(195 - pct * 1.85);
/** A whole percent: `36%`. */
const wholePct = (value: number) => formatPercent(Math.round(value));

/** Damage that reached HP; the absorbed part is not shown. */
function hpDamage(e: RecapEvent): number {
  return Math.max(0, e.amount - e.absorbed);
}

export interface RecapTick {
  leftPct: number;
  heightPx: number;
}

export interface RecapPlot {
  startMs: number;
  endMs: number;
  line: string;
  area: string;
  damage: RecapTick[];
  heals: RecapTick[];
}

export function recapPlot(recap: DeathRecap): RecapPlot {
  const startMs = Math.max(0, recap.t - RECAP_WINDOW_MS);
  const endMs = recap.t + RECAP_TAIL_MS;
  const x = (time: number) => round1(((time - startMs) / (endMs - startMs)) * WIDTH);
  const points = recap.hp.filter((p) => p.t >= startMs && p.t <= endMs).map((p) => [x(p.t), hpY(p.pct)] as const);
  // The line starts at the left edge: the first snapshot holds back to the window start.
  if (points.length > 1 && points[0][0] > 0) points.unshift([0, points[0][1]]);
  let line = '';
  let area = '';
  if (points.length === 1) {
    // One snapshot has no neighbour: a short flat piece at it, no area.
    const [px, py] = points[0];
    line = `M ${round1(Math.max(0, px - 10))} ${py} L ${round1(Math.min(WIDTH, px + 10))} ${py}`;
  } else if (points.length > 1) {
    line = points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'} ${px} ${py}`).join(' ');
    area = `${line} L ${points[points.length - 1][0]} ${HEIGHT} L ${points[0][0]} ${HEIGHT} Z`;
  }
  const tick = (time: number, amount: number): RecapTick => ({
    leftPct: round1(x(time) / 10),
    heightPx: Math.round(Math.min(60, Math.max(3, amount / 6000))),
  });
  const inWindow = recap.events.filter((e) => e.t >= startMs && e.t <= recap.t);
  return {
    startMs,
    endMs,
    line,
    area,
    damage: inWindow.filter((e) => e.kind === 'damage' && hpDamage(e) > 0).map((e) => tick(e.t, hpDamage(e))),
    heals: inWindow.filter((e) => e.kind === 'heal' && e.amount > 0).map((e) => tick(e.t, e.amount)),
  };
}

export interface RecapCallout {
  /** Orange, 600: the burst or the lethal spell. */
  lead: string;
  body: string;
  /** Orange: what was not used. */
  warning: string;
}

const CONSUMABLE_WORD: Record<'healthstone' | 'health_potion', MessageKey> = {
  healthstone: 'player.death.healthstone',
  health_potion: 'player.death.healthPotion',
};

const capitalise = (text: string) => `${text.charAt(0).toLocaleUpperCase(locale)}${text.slice(1)}`;

/** The player's HP at the last snapshot before `time`. */
function hpBefore(recap: DeathRecap, time: number): number | null {
  return [...recap.hp].reverse().find((p) => p.t < time)?.pct ?? null;
}

/**
 * "2× Virulent Spit within 1.0 s – 355k each (≈ 38% of max HP). The first hit dropped HP from 74% to 36%, …";
 * used items and the combat potion are not mentioned.
 */
export function recapCallout(recap: DeathRecap, spellName: (id: number) => string): RecapCallout | null {
  const kb = recap.killingBlow;
  const ofMax = (amount: number) =>
    recap.maxHp && recap.maxHp > 0 ? t('recap.callout.ofMax', { pct: wholePct((amount / recap.maxHp) * 100) }) : '';
  const defensives = recap.context.filter((c) => c.item === 'defensive');
  const cooldown = defensives.filter((c) => c.state === 'on_cooldown').map((c) => spellName(c.spellId));
  const unused = [
    ...defensives.filter((c) => c.state === 'available' || c.state === 'never_used').map((c) => spellName(c.spellId)),
    ...recap.context
      .filter((c): c is ContextEntry & { item: 'healthstone' | 'health_potion' } => c.item === 'healthstone' || c.item === 'health_potion')
      .filter((c) => c.state === 'available')
      .map((c) => t(CONSUMABLE_WORD[c.item])),
  ];
  if (!kb && cooldown.length === 0 && unused.length === 0) return null;

  let lead: string;
  let body = '';
  if (!kb) {
    lead = t('deaths.noLethalHit');
    body = '.';
  } else {
    const spell = hitName(kb, spellName);
    const burst = recap.lethalBurst && recap.lethalBurst.count > 1 ? recap.lethalBurst : null;
    if (burst) {
      const hits = recap.events.filter(
        (e) => e.kind === 'damage' && e.spellId === burst.spellId && e.environmental === kb.environmental && e.t >= kb.t - burst.windowMs && e.t <= kb.t,
      );
      const amounts = hits.map(hpDamage);
      const total = amounts.reduce((sum, a) => sum + a, 0);
      const same = amounts.length > 0 && amounts.every((a) => formatAmount(a) === formatAmount(amounts[0]));
      lead = t('recap.callout.burst', { count: burst.count, spell, window: formatSeconds(burst.windowMs) });
      if (amounts.length > 0) {
        body += same
          ? `${t('recap.callout.each', { amount: formatAmount(amounts[0]) })}${ofMax(amounts[0])}`
          : `${t('recap.callout.together', { amount: formatAmount(total) })}${ofMax(total)}`;
      }
      const first = hits[0];
      const from = first ? hpBefore(recap, first.t) : null;
      const to = first?.hpPct ?? null;
      body +=
        from !== null && to !== null
          ? `${t('recap.callout.drop', { from: wholePct(from), to: wholePct(to) })}${t(burst.count === 2 ? 'recap.callout.lethalSecond' : 'recap.callout.lethalLast')}`
          : '.';
    } else {
      lead = spell;
      if (kb.amount > 0) body += `${t('recap.callout.hit', { amount: formatAmount(kb.amount) })}${ofMax(kb.amount)}`;
      const at = hpBefore(recap, kb.t);
      body += at !== null ? t('recap.callout.at', { hp: wholePct(at) }) : '.';
    }
  }
  if (cooldown.length > 0) {
    body += ` ${t('recap.callout.onCooldown', { count: cooldown.length, list: formatList(cooldown) })}${unused.length > 0 ? '; ' : '.'}`;
  } else if (unused.length > 0) {
    body += ' ';
  }
  const warning = unused.length > 0 ? capitalise(t('recap.callout.unused', { count: unused.length, list: formatList(unused) })) : '';
  return { lead, body, warning };
}

/** Who dealt a hit: its source (a player without the realm), else world damage, a debuff whose caster is gone, or unknown. */
export function hitSource(hit: { sourceName: string | null; environmental: boolean; periodic: boolean }): string {
  if (hit.sourceName) return shortName(hit.sourceName);
  if (hit.environmental) return t('deaths.environment');
  return t(hit.periodic ? 'recap.debuffSource' : 'deaths.unknownSource');
}

/** The source column of the events table: "Mulgar (Totem)", "Tyrell", "Ula'tek", "Debuff". */
export function eventSource(e: RecapEvent): string {
  if (e.sourceOwnerName) {
    const kind = /totem/i.test(e.sourceName ?? '') ? t('recap.totem') : t('recap.pet');
    return t('recap.ownedSource', { owner: shortName(e.sourceOwnerName), kind });
  }
  return e.sourceName ? shortName(e.sourceName) : hitSource(e);
}

export interface RecapRow {
  key: string;
  event: RecapEvent;
  time: string;
  name: string;
  source: string;
  amount: string;
  /** Damage rows only; `—` when the log gave no HP. */
  hp: string;
  tone: 'kill' | 'big' | null;
}

/**
 * Damage (as HP damage) and heals of the last 3 s, newest first. Times count back from the killing blow,
 * not from UNIT_DIED ~10 ms later; fully overhealed heals are left out as in the HP chart.
 */
export function recapRows(recap: DeathRecap, spellName: (id: number) => string): RecapRow[] {
  const kb = recap.killingBlow;
  const big = recap.maxHp && recap.maxHp > 0 ? recap.maxHp * BIG_HIT_SHARE : BIG_HIT_FALLBACK;
  const shown = recap.events
    .map((event, index) => ({ event, index }))
    .filter(({ event: e }) => e.t >= recap.t - RECAP_EVENTS_MS && e.t <= recap.t)
    .filter(({ event: e }) => (e.kind === 'heal' && e.amount > 0) || (e.kind === 'damage' && hpDamage(e) > 0))
    .reverse();
  const anchor = kb?.t ?? recap.t;
  let killMarked = false;
  return shown.map(({ event: e, index }) => {
    const damage = e.kind === 'damage';
    const isKill = damage && !killMarked && kb !== null && e.t === kb.t && e.spellId === kb.spellId && e.environmental === kb.environmental;
    if (isKill) killMarked = true;
    const overkill = damage && e.excess > 0 ? ` ${t('deaths.overkill', { amount: formatInteger(e.excess) })}` : '';
    return {
      key: `${e.t}-${index}`,
      event: e,
      time: formatOffsetSeconds(anchor - e.t),
      name: hitName(e, spellName),
      source: eventSource(e),
      amount: damage ? `${formatSignedInteger(-hpDamage(e))}${overkill}` : formatSignedInteger(e.amount),
      // A SWING's HP block is the attacker's: the killing row is 0 % all the same.
      hp: damage ? (e.hpPct !== null ? wholePct(e.hpPct) : isKill ? wholePct(0) : '—') : '',
      tone: isKill ? 'kill' : damage && hpDamage(e) >= big ? 'big' : null,
    };
  });
}

export type ContextTone = 'st-cd' | 'st-us' | 'st-un';

export interface ContextRow {
  key: string;
  spellId: number;
  name: string;
  /** "3:24 · −35 s": when it was used and how long before the death. */
  when: string | null;
  state: string;
  tone: ContextTone;
}

const ORDER: Record<ContextItem, number> = { defensive: 0, healthstone: 1, health_potion: 2, combat_potion: 3 };

/** A drunk stone or potion is "used" whatever its cooldown; an unused combat potion is grey, other unused items orange. */
export function contextRows(recap: DeathRecap, spellName: (id: number) => string): { defensives: ContextRow[]; consumables: ContextRow[] } {
  const row = (c: ContextEntry): ContextRow => {
    const spent = c.state === 'used' || (c.item !== 'defensive' && c.state === 'on_cooldown');
    const when = c.t !== null && (spent || c.state === 'on_cooldown') ? t('recap.when', { time: usedAtLabel(c.t), ago: formatAgo(recap.t - c.t) }) : null;
    const base = { key: `${c.item}-${c.spellId}`, spellId: c.spellId, name: spellName(c.spellId), when };
    if (spent) return { ...base, state: t('recap.state.used'), tone: 'st-us' };
    if (c.state === 'on_cooldown') return { ...base, state: t('recap.state.onCooldown'), tone: 'st-cd' };
    if (c.state === 'never_used') return { ...base, state: t('context.state.neverUsed'), tone: 'st-un' };
    return { ...base, state: t('context.available'), tone: c.item === 'combat_potion' ? 'st-cd' : 'st-un' };
  };
  return {
    defensives: recap.context.filter((c) => c.item === 'defensive').map(row),
    consumables: recap.context
      .filter((c) => c.item !== 'defensive')
      .sort((a, b) => ORDER[a.item] - ORDER[b.item])
      .map(row),
  };
}
