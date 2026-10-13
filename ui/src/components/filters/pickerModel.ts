import type { FilterOption, PlayerRef } from '../../api/types';
import { t } from '../../i18n/i18n';
import { shortName } from '../overview/players';
import { type ScopeValue, optionLabel, optionValue, sameValue, valueLabel } from './labels';

export interface PickerSection {
  title: string;
  options: FilterOption[];
}

export interface PickerContext {
  roster: Map<number, PlayerRef>;
  /** The pull's encounter name: units of this name are the "Boss" section. */
  boss: string;
  /** Players by role; otherwise players, with their pets, are "Other sources". */
  playersByRole: boolean;
}

const ORDER = ['boss', 'adds', 'tanks', 'healers', 'damage', 'other', 'abilities'] as const;
type Bucket = (typeof ORDER)[number];

function matches(option: FilterOption, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    optionLabel(option).toLowerCase().includes(q) ||
    String(option.npcId ?? '').startsWith(q) ||
    option.variants.some((v) => String(v.spellId).startsWith(q))
  );
}

function bucketOf(value: ScopeValue, context: PickerContext): Bucket {
  switch (value.kind) {
    case 'player': {
      if (!context.playersByRole) return 'other';
      const role = context.roster.get(value.actorId)?.role;
      return role === 'tank' ? 'tanks' : role === 'healer' ? 'healers' : 'damage';
    }
    case 'pet':
    case 'environment':
      return 'other';
    case 'unit':
      return value.name === context.boss ? 'boss' : 'adds';
    case 'instance':
      return 'adds';
    case 'name':
    case 'id':
      return 'abilities';
  }
}

export function pickerSections(options: FilterOption[], context: PickerContext, query: string): PickerSection[] {
  const buckets = new Map<Bucket, FilterOption[]>();
  for (const option of options.filter((o) => matches(o, query.trim()))) {
    const bucket = bucketOf(optionValue(option), context);
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), option]);
  }
  return ORDER.filter((key) => buckets.has(key)).map((key) => ({
    title: key === 'abilities' ? '' : t(`picker.section.${key}`),
    options: buckets.get(key)!,
  }));
}

/** The picker button's text for a selection, also when the options no longer hold it. */
export function selectionLabel(value: ScopeValue, options: FilterOption[], roster: Map<number, PlayerRef>): string {
  const direct = options.find((o) => sameValue(optionValue(o), value));
  if (direct) return optionLabel(direct);
  switch (value.kind) {
    case 'player': {
      const player = roster.get(value.actorId);
      return player ? shortName(player.name) : t('report.unknownPlayer');
    }
    case 'instance': {
      for (const o of options) {
        const hit = o.instances.find((i) => i.actorId === value.actorId);
        if (hit) return valueLabel(value, o.name, hit.number);
      }
      return valueLabel(value, '');
    }
    case 'id': {
      const parent = options.find((o) => o.variants.some((v) => v.spellId === value.spellId));
      return parent ? t('picker.variantOf', { name: optionLabel(parent), id: value.spellId }) : valueLabel(value, '');
    }
    default:
      return valueLabel(value, '');
  }
}
