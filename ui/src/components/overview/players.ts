/** "Faelan-Emberfall-EU" → "Faelan"; character names cannot contain hyphens. */
export function shortName(name: string): string {
  return name.split('-')[0];
}

export function classColor(token: string | null): string {
  return token ? `var(--class-${token.toLowerCase()})` : 'var(--text)';
}
