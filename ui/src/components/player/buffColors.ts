import type { BuffKind } from '../../api/types';

/** Procs take the player's class colour. */
export function buffColor(kind: BuffKind, classColour: string): string {
  switch (kind) {
    case 'aug':
      return 'var(--class-evoker)';
    case 'lust':
      return 'var(--lust)';
    case 'external':
      return 'var(--text-soft)';
    case 'cooldown':
      return 'var(--accent)';
    case 'proc':
      return classColour;
    case 'shield':
    case 'defensive':
      return 'var(--neutral-text)';
  }
}
