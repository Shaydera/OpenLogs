import type { EventRow, EventRowType } from '../../api/types';
import { formatEventTimeMs, formatScaled, formatSecondsExact, formatDuration, formatInteger } from '../../i18n/format';
import { type MessageKey, t } from '../../i18n/i18n';
import type { FilterTab } from '../../scopeSides';
import type { ViewNames } from './viewNames';

/** The last column of each tab's events. */
export const VALUE_CAPTION: Record<FilterTab, MessageKey> = {
  damage: 'events.value.amount',
  healing: 'events.value.amount',
  taken: 'events.value.amount',
  casts: 'events.value.castTime',
  buffs: 'events.value.stacks',
  deaths: 'events.value.amount',
  interrupts: 'events.value.used',
  resources: 'events.value.amount',
};

export const typeLabel = (row: EventRow): string => t(`events.type.${row.type}`);

/** A row's figure in the tab's last column; empty when it has none. */
export function valueOf(tab: FilterTab, row: EventRow, names: ViewNames): string {
  switch (tab) {
    case 'casts':
      return row.type === 'cast' && row.durationMs !== null && row.stage === null ? formatSecondsExact(row.durationMs) : '';
    case 'buffs':
      return row.stacks === null ? '' : formatInteger(row.stacks);
    case 'interrupts':
      return row.used === null ? '' : names.spell(row.used);
    case 'deaths':
      return row.type === 'died' || row.amount === null ? '' : formatScaled(row.amount);
    default:
      return row.amount === null ? '' : formatScaled(row.amount);
  }
}

/** A death's amount is the killing blow's overkill. */
const overkillOf = (row: EventRow): number => (row.type === 'died' ? (row.amount ?? 0) : row.overkill);
const overkillNote = (row: EventRow): string => (row.type === 'died' && overkillOf(row) > 0 ? t('events.overkill', { amount: formatScaled(overkillOf(row)) }) : '');
const aliveNote = (row: EventRow): string => (row.aliveMs === null ? '' : t('events.alive', { duration: formatDuration(row.aliveMs) }));

/** What the log says about the row besides its columns. */
export function noteOf(row: EventRow, names: ViewNames): string {
  const duration = row.durationMs === null ? '' : formatSecondsExact(row.durationMs);
  const by = row.by && { name: names.unit(row.by.actorId), spell: names.spell(row.by.spellId) };
  switch (row.type) {
    case 'beginCast':
      if (row.outcome === 'released') return t('events.outcome.released', { stage: row.stage ?? 0, duration });
      return row.outcome ? t(`events.outcome.${row.outcome}`, { duration }) : '';
    case 'cast':
      if (row.pressMs !== null) return t('events.partOf', { time: formatEventTimeMs(row.pressMs) });
      return row.stage !== null ? t('events.empowered', { stage: row.stage, duration }) : '';
    case 'interrupted':
      return by ? t('events.interruptedBy', by) : duration && t('events.interruptedAfter', { duration });
    case 'rejected':
      return t('events.rejected', { reason: row.reason ?? '' });
    case 'remove':
      return by ? t('events.brokenBy', by) : '';
    case 'absorb':
      return by ? t('events.attacker', by) : '';
    case 'died':
      if (row.event === 'ENCOUNTER_END') return t('events.pullEnd');
      return [overkillNote(row), aliveNote(row)].filter(Boolean).join(' · ');
    default:
      return row.critical ? t('events.critical') : '';
  }
}

/** The row's parsed fields, as the log has them. */
export function fieldsOf(row: EventRow, names: ViewNames): { key: MessageKey; value: string }[] {
  const fields: { key: MessageKey; value: string | null }[] = [
    { key: 'events.field.event', value: row.event },
    { key: 'events.field.spellId', value: String(row.spellId) },
    { key: 'events.field.amount', value: row.type === 'died' || row.amount === null ? null : formatInteger(row.amount) },
    { key: 'events.field.overkill', value: overkillOf(row) > 0 ? formatInteger(overkillOf(row)) : null },
    { key: 'events.field.absorbed', value: row.absorbed > 0 ? formatInteger(row.absorbed) : null },
    { key: 'events.field.blocked', value: row.blocked > 0 ? formatInteger(row.blocked) : null },
    { key: 'events.field.resisted', value: row.resisted > 0 ? formatInteger(row.resisted) : null },
    { key: 'events.field.overheal', value: row.overheal > 0 ? formatInteger(row.overheal) : null },
    { key: 'events.field.critical', value: row.critical ? t('events.field.yes') : null },
    { key: 'events.field.targetHp', value: row.targetHp && t('events.field.hp', { current: formatInteger(row.targetHp[0]), max: formatInteger(row.targetHp[1]) }) },
    { key: 'events.field.stacks', value: row.stacks === null ? null : formatInteger(row.stacks) },
    { key: 'events.field.stage', value: row.stage === null ? null : formatInteger(row.stage) },
    { key: 'events.field.reason', value: row.reason },
    { key: 'events.field.used', value: row.used === null ? null : `${names.spell(row.used)} (${row.used})` },
  ];
  return fields.filter((field): field is { key: MessageKey; value: string } => field.value !== null);
}

const unitLabel = (names: ViewNames, actorId: number, fallback: string): string => {
  const owner = names.owner(actorId);
  return `${names.unit(actorId) || fallback}${owner ? ` (${owner})` : ''}`;
};

/** The row as one sentence for the text layout. */
export function sentenceOf(tab: FilterTab, row: EventRow, names: ViewNames): string {
  const source = unitLabel(names, row.source, row.environmental ? t('scope.environment') : t('events.noSource'));
  const target = unitLabel(names, row.target, t('events.noTarget'));
  const spell = row.unknownBlow ? t('events.noBlow') : names.spell(row.spellId);
  const values = { source, target, spell, amount: valueOf(tab, row, names), used: row.used === null ? '' : names.spell(row.used) };
  switch (row.type) {
    case 'beginCast':
      return t('events.text.beginCast', { ...values, outcome: noteOf(row, names) || t('events.outcome.noOutcome') });
    case 'cast':
      return t(row.target === 0 ? 'events.text.cast' : 'events.text.castOn', values);
    case 'rejected':
      return t('events.text.rejected', { ...values, reason: row.reason ?? '' });
    case 'died':
      if (row.event === 'ENCOUNTER_END') return t('events.text.diedAtEnd', values);
      if (row.unknownBlow) return t('events.text.diedNoBlow', values);
      return overkillOf(row) > 0 ? t('events.text.diedOverkill', { ...values, overkill: formatScaled(overkillOf(row)) }) : t('events.text.died', values);
    default:
      return t(`events.text.${row.type}`, values);
  }
}

const SAYS_VALUE: EventRowType[] = ['damage', 'tick', 'melee', 'ranged', 'heal', 'hotTick', 'absorb', 'recap', 'interrupt', 'dispel', 'steal'];

/** The tab's value where the row's sentence does not already say it (cast time, stacks). */
export const textValueOf = (tab: FilterTab, row: EventRow, names: ViewNames): string => (SAYS_VALUE.includes(row.type) ? '' : valueOf(tab, row, names));

/** What follows the sentence: the notes it does not already say. */
export function textNoteOf(row: EventRow, names: ViewNames): string {
  switch (row.type) {
    case 'interrupted':
      if (row.by) return t('events.interruptedByText', { name: names.unit(row.by.actorId), spell: names.spell(row.by.spellId) });
      return row.durationMs === null ? '' : t('events.afterText', { duration: formatSecondsExact(row.durationMs) });
    case 'beginCast':
    case 'rejected':
      return '';
    case 'died':
      return row.event === 'ENCOUNTER_END' ? '' : aliveNote(row);
    default:
      return noteOf(row, names);
  }
}
