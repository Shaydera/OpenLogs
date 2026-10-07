function onWindows(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows');
}

/**
 * URL of an image served by the `wowicon` protocol. Tauri exposes custom schemes as
 * `http://<scheme>.localhost` on Windows and as `<scheme>://localhost` elsewhere.
 */
export function iconUrl(path: string, windows = onWindows()): string {
  return windows ? `http://wowicon.localhost/${path}` : `wowicon://localhost/${path}`;
}

export const spellIconUrl = (spellId: number) => iconUrl(`spell/${spellId}`);
export const classIconUrl = (classId: number) => iconUrl(`class/${classId}`);
export const specIconUrl = (specId: number) => iconUrl(`spec/${specId}`);
export const namedIconUrl = (name: string) => iconUrl(`icon/${encodeURIComponent(name)}`);

/** A boss portrait (Warcraft Logs, Encounter Journal or shipped icon); 404 when there is none. */
export const bossIconUrl = (encounterId: number) => iconUrl(`boss/${encounterId}`);
