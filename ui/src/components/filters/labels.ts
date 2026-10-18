import type { AbilityRef, BreakdownRow, BreakdownRowKind, FilterOption, RowKey, UnitRef } from '../../api/types';
import { t } from '../../i18n/i18n';
import { shortName } from '../overview/players';

export type ScopeValue = UnitRef | AbilityRef;

export const rowValue = (key: RowKey): ScopeValue => (key.kind === 'unit' ? key.unit : key.ability);
export const optionValue = (option: FilterOption): ScopeValue => (option.value.kind === 'unit' ? option.value.unit : option.value.ability);
export const sameValue = (a: ScopeValue, b: ScopeValue) => JSON.stringify(a) === JSON.stringify(b);

/** The display text of a unit or ability; `name` and `number` as the service sends them. */
export function valueLabel(value: ScopeValue, name: string, number: number | null = null, rowKind: BreakdownRowKind = 'own'): string {
  if (rowKind === 'unmatched') return t('report.unmatchedHits');
  switch (value.kind) {
    case 'environment':
      return t('scope.environment');
    case 'name':
    case 'pet':
    case 'unit':
      return value.name;
    case 'id':
      return value.spellId === 0 ? t('overview.melee') : t('overview.unknownSpell', { id: value.spellId });
    case 'player':
      return name || t('report.unknownPlayer');
    case 'instance': {
      const shown = name || t('scope.unknownUnit');
      return number === null ? shown : t('scope.instance', { name: shown, number });
    }
  }
}

export const rowLabel = (row: BreakdownRow) =>
  valueLabel(rowValue(row.key), row.name, row.number, row.key.kind === 'ability' ? row.key.rowKind : 'own');

export const rowPet = (key: RowKey): string | null => (key.kind === 'ability' && key.pet ? shortName(key.pet) : null);

/** The label with the pets behind an ability, for where the pet name is not shown beside it. */
export function petLabel(label: string, key: RowKey): string {
  const pet = rowPet(key);
  return pet ? t('scope.petAbility', { name: label, pet }) : label;
}

export const showOnlyLabel = (row: BreakdownRow) => t('breakdown.showOnly', { name: petLabel(rowLabel(row), row.key) });

export const optionLabel = (option: FilterOption) => valueLabel(optionValue(option), option.name, option.number);
