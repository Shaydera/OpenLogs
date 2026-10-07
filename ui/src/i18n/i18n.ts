import { en } from './en';

export type MessageKey = keyof typeof en;
type Params = Record<string, string | number>;
type Entry = string | Readonly<Partial<Record<Intl.LDMLPluralRule, string>>>;

/** Active locale for messages and `Intl` formatting. Only English exists for now. */
export const locale = 'en-US';

const pluralRules = new Intl.PluralRules(locale);
/** `count` is a quantity: grouped like every other number in the UI. */
const countFormat = new Intl.NumberFormat(locale);

export function t(key: MessageKey, params: Params = {}): string {
  const entry: Entry = en[key];
  const template =
    typeof entry === 'string'
      ? entry
      : (entry[pluralRules.select(Number(params.count ?? 0))] ?? entry.other ?? key);
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    if (!(name in params)) return placeholder;
    const value = params[name];
    return name === 'count' && typeof value === 'number' ? countFormat.format(value) : String(value);
  });
}
