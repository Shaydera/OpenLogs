import type { AbilityRow, PlayerRef, TakenAbility } from '../../api/types';
import { spellIcon } from '../../icons';
import { t } from '../../i18n/i18n';
import { classColor, shortName } from '../overview/players';
import { hitIcon, hitName, reportSpellName, sourceLabel, type SpellNames } from './reportData';

/** How many abilities the side panel lists before "Other", which always comes after them. */
const TOP_ABILITIES = 5;

export type BreakdownTone = 'normal' | 'other' | 'support' | 'negative';

/** A row of the side panel's ability list. */
export interface BreakdownRow {
  key: string;
  tone: BreakdownTone;
  /** Icon URL; `null` draws a "…" placeholder (Other and the deductions). */
  icon: string | null;
  name: string;
  /** Muted text after the name: a pet, the source of damage taken. */
  note: string | null;
  /** Class colour of a note that names a player. */
  noteColor: string | null;
  /** Negative for deductions. */
  amount: number;
  /** Of the player's total in the current mode (0–1); `null` for deductions and a zero total. */
  share: number | null;
  /** Bar width in % of the largest positive row. */
  barPct: number;
}

export interface BreakdownContext {
  total: number;
  spells: SpellNames;
  roster: Map<number, PlayerRef>;
  top?: number;
}

type Entry = Omit<BreakdownRow, 'share' | 'barPct'>;

/** Rows with one key become one: same-name spells (several IDs), deductions of one Evoker. */
function merged(entries: Entry[]): Entry[] {
  const byKey = new Map<string, Entry>();
  for (const entry of entries) {
    const found = byKey.get(entry.key);
    if (found) found.amount += entry.amount;
    else byKey.set(entry.key, { ...entry });
  }
  return [...byKey.values()];
}

const byAmount = (a: Entry, b: Entry) => b.amount - a.amount || a.name.localeCompare(b.name);

function topWithOther(entries: Entry[], top: number): Entry[] {
  const sorted = [...entries].sort(byAmount);
  const shown = sorted.slice(0, top);
  const rest = sorted.slice(top).reduce((sum, entry) => sum + entry.amount, 0);
  if (rest > 0) shown.push({ key: 'other', tone: 'other', icon: null, name: t('report.other'), note: null, noteColor: null, amount: rest });
  return shown;
}

/** Keeps the order: the top rows by amount, "Other", then unmatched support. */
function finish(entries: Entry[], total: number): BreakdownRow[] {
  const max = Math.max(0, ...entries.map((entry) => entry.amount));
  return entries.map((entry) => ({
    ...entry,
    share: entry.amount < 0 || total <= 0 ? null : entry.amount / total,
    barPct: max > 0 ? Math.min(100, (Math.abs(entry.amount) * 100) / max) : 0,
  }));
}

/**
 * Damage Done / Healing side panel: the top abilities by amount — own and pet abilities (same name merged, pets
 * included; net of Aug support in Reattributed mode) and an Evoker's support rows — then "Other" and unmatched support.
 */
export function abilityBreakdown(rows: AbilityRow[], ctx: BreakdownContext): BreakdownRow[] {
  const abilities: Entry[] = [];
  const unmatched: Entry[] = [];
  for (const row of rows) {
    const name = reportSpellName(ctx.spells, row.spellId);
    const icon = spellIcon(row.spellId);
    if (row.kind === 'own' || row.kind === 'pet') {
      // A pet's ability merges into the own row of the same name (Eruption = own + Future Self).
      abilities.push({ key: `own:${name}`, tone: 'normal', icon, name, note: null, noteColor: null, amount: row.amount });
    } else if (row.kind === 'support_given') {
      abilities.push({ key: `support:${name}`, tone: 'support', icon, name, note: null, noteColor: null, amount: row.amount });
    } else {
      unmatched.push({ key: 'unmatched', tone: 'negative', icon: null, name: t('report.unmatchedHits'), note: null, noteColor: null, amount: row.amount });
    }
  }
  return finish([...topWithOther(merged(abilities), ctx.top ?? TOP_ABILITIES), ...unmatched], ctx.total);
}

/** The source of damage taken: a player by short name in the class colour, else the log's name. */
export function takenSource(
  hit: Pick<TakenAbility, 'sourceId' | 'sourceName' | 'environmental'>,
  roster: Map<number, PlayerRef>,
): { label: string; color: string | null } {
  const player = hit.sourceId === null ? undefined : roster.get(hit.sourceId);
  if (player) return { label: shortName(player.name), color: classColor(player.classToken) };
  return { label: sourceLabel(hit), color: null };
}

/** Damage Taken side panel: the player's damage by ability and source, top rows and "Other". */
export function takenBreakdown(abilities: TakenAbility[], ctx: BreakdownContext): BreakdownRow[] {
  const entries = abilities.map((hit): Entry => {
    const name = hitName(hit, (id) => reportSpellName(ctx.spells, id));
    const source = takenSource(hit, ctx.roster);
    return { key: `${hit.environmental}:${name}:${source.label}`, tone: 'normal', icon: hitIcon(hit), name, note: source.label, noteColor: source.color, amount: hit.amount };
  });
  return finish(topWithOther(merged(entries), ctx.top ?? TOP_ABILITIES), ctx.total);
}
