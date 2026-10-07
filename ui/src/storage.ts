const PREFIX = 'openlogs.';

/** `null` when nothing is stored or storage is unavailable (blocked, private mode). */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

/** Best effort: when storage is unavailable the value applies for this session only. */
export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // Not persisted.
  }
}
