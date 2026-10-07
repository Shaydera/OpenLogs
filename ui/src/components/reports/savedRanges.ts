import { readStored, writeStored } from '../../storage';

export interface SavedRange {
  name: string;
  startMs: number;
  endMs: number;
}

/** The save form's `maxLength`; longer stored names were not written by the app. */
export const MAX_RANGE_NAME = 24;
/** The backend filter takes `i32` milliseconds. */
const MAX_RANGE_MS = 2 ** 31 - 1;

const storageKey = (key: string) => `ranges.${key}`;

function isSavedRange(value: unknown): value is SavedRange {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === 'string' &&
    v.name.trim() !== '' &&
    v.name.length <= MAX_RANGE_NAME &&
    Number.isInteger(v.startMs) &&
    Number.isInteger(v.endMs) &&
    (v.startMs as number) >= 0 &&
    (v.endMs as number) > (v.startMs as number) &&
    (v.endMs as number) <= MAX_RANGE_MS
  );
}

/** Saved ranges for one boss and difficulty; invalid entries are ignored and the first of a name wins. */
export function loadSavedRanges(key: string): SavedRange[] {
  try {
    const parsed: unknown = JSON.parse(readStored(storageKey(key)) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const ranges: SavedRange[] = [];
    for (const entry of parsed) {
      if (isSavedRange(entry) && !ranges.some((r) => r.name === entry.name)) {
        ranges.push({ name: entry.name, startMs: entry.startMs, endMs: entry.endMs });
      }
    }
    return ranges;
  } catch {
    return [];
  }
}

function store(key: string, ranges: SavedRange[]): SavedRange[] {
  writeStored(storageKey(key), JSON.stringify(ranges));
  return ranges;
}

/** Adds `range`, replacing a saved range of the same name in place. */
export function saveRange(key: string, range: SavedRange): SavedRange[] {
  const ranges = loadSavedRanges(key);
  const at = ranges.findIndex((r) => r.name === range.name);
  return store(key, at === -1 ? [...ranges, range] : ranges.map((r, i) => (i === at ? range : r)));
}

export function deleteRange(key: string, name: string): SavedRange[] {
  return store(key, loadSavedRanges(key).filter((r) => r.name !== name));
}
