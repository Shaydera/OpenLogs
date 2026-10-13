import type { Database } from './db';
import type { LogSource } from './logSource';
import type { LogView } from './types';

const MAX_RECENT = 12;

/** A recently opened log as stored; the handle exists only in Chromium browsers. */
export interface RecentRecord {
  id: string;
  fileName: string;
  sizeBytes: number;
  zone: string | null;
  startUnixMs: number | null;
  pullCount: number;
  openedAtUnixMs: number;
  handle?: FileSystemFileHandle;
}

/** Newest first. */
export async function recentRecords(db: Database): Promise<RecentRecord[]> {
  const records = await db.all<RecentRecord>('recent');
  return records.sort((a, b) => b.openedAtUnixMs - a.openedAtUnixMs);
}

export async function rememberLog(db: Database, source: LogSource, view: LogView, openedAtUnixMs: number): Promise<void> {
  await db.put('recent', {
    id: source.id,
    fileName: source.name,
    sizeBytes: source.size,
    zone: view.zone,
    startUnixMs: view.startUnixMs,
    // A run is no pull; its boss pulls are.
    pullCount: view.fights.filter((fight) => fight.run === null).length,
    openedAtUnixMs,
    handle: source.handle,
  } satisfies RecentRecord);
  for (const stale of (await recentRecords(db)).slice(MAX_RECENT)) await db.delete('recent', stale.id);
}
