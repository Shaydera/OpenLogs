import type { ContextEntry, ContextItem, DeathEntry, Hit, QuickOverview } from '../../api/types';
import { formatAgo, formatAmountWhole } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/i18n';
import { hitIcon, hitName } from '../reports/reportData';
import { spellName, usedAtLabel } from './players';

/** Parts of the last 5 s shown, one per segment tone; smaller parts leave the track colour. */
export const MAX_PARTS = 4;

export interface DamagePart {
  key: string;
  name: string;
  icon: string;
  amount: string;
  /** Share of all damage taken in the last 5 s, 0–100. */
  widthPct: number;
  /** 1–4: `--segment-<tone>`. */
  tone: number;
}

export function damageParts(overview: QuickOverview, death: DeathEntry): DamagePart[] {
  return death.damageLast5s.slice(0, MAX_PARTS).map((part, i) => ({
    key: `${part.spellId}-${part.environmental}`,
    name: hitName(part, (id) => spellName(overview, id)),
    icon: hitIcon(part),
    amount: formatAmountWhole(part.amount),
    widthPct: death.damageTaken5s > 0 ? (part.amount / death.damageTaken5s) * 100 : 0,
    tone: i + 1,
  }));
}

/** Who dealt a hit; a source-less hit is the environment or a debuff without a source. */
export function deathSource(hit: Pick<Hit, 'sourceName' | 'environmental'>): string {
  return hit.sourceName ?? t(hit.environmental ? 'deaths.environment' : 'deaths.noSource');
}

export type BadgeTone = 'b-used' | 'b-cd' | 'b-unused';

export interface ContextBadge {
  key: string;
  spellId: number;
  name: string;
  state: string;
  tone: BadgeTone;
}

const ORDER: Record<ContextItem, number> = { defensive: 0, healthstone: 1, health_potion: 2, combat_potion: 3 };

const CONSUMABLE_NAME: Record<Exclude<ContextItem, 'defensive'>, MessageKey> = {
  healthstone: 'context.healthstone',
  health_potion: 'context.healthPotion',
  combat_potion: 'context.combatPotion',
};

/** The context badges of a death, personal defensives first. */
export function contextBadges(overview: QuickOverview, death: DeathEntry): ContextBadge[] {
  return [...death.context].sort((a, b) => ORDER[a.item] - ORDER[b.item]).map((entry) => badge(overview, death, entry));
}

function badge(overview: QuickOverview, death: DeathEntry, entry: ContextEntry): ContextBadge {
  const consumable = entry.item !== 'defensive';
  const base = {
    key: `${entry.item}-${entry.spellId}`,
    spellId: entry.spellId,
    name: entry.item === 'defensive' ? spellName(overview, entry.spellId) : t(CONSUMABLE_NAME[entry.item]),
  };
  const usedAt = entry.t ?? death.t;
  // A consumable drunk earlier counts as used whatever its cooldown, so the badge shows its time.
  if (entry.state === 'used' || (consumable && entry.state === 'on_cooldown')) {
    return { ...base, state: usedAtLabel(usedAt), tone: 'b-used' };
  }
  if (entry.state === 'on_cooldown') {
    return { ...base, state: t('context.state.onCooldown', { ago: formatAgo(death.t - usedAt) }), tone: 'b-cd' };
  }
  return { ...base, state: t(entry.state === 'never_used' ? 'context.state.neverUsed' : 'context.state.unused'), tone: 'b-unused' };
}
