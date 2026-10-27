import { RELEASES_API_URL, RELEASES_URL } from './build';

export const UPDATE_CHECK_MS = 30 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

export interface AvailableUpdate {
  version: string;
  url: string;
}

export interface Release {
  tag_name: string;
  html_url: string;
  draft: boolean;
}

interface Version {
  core: [number, number, number];
  prerelease: string | null;
}

/** The tag format the release workflow accepts: `vX.Y.Z`, an optional `-pre` part and an optional `+build` part. */
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function formatVersion({ core, prerelease }: Version): string {
  return prerelease === null ? core.join('.') : `${core.join('.')}-${prerelease}`;
}

function parseVersion(text: string): Version | null {
  const match = VERSION.exec(text);
  if (!match) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] ?? null };
}

/** Digit runs compare as numbers, so `beta10` follows `beta9` (SemVer would put it first). */
function comparePrerelease(a: string, b: string): number {
  const pieces = (text: string) => text.split('.').flatMap((part) => part.match(/\d+|\D+/g) ?? []);
  const left = pieces(a);
  const right = pieces(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const x = left[i];
    const y = right[i];
    const xNumeric = /^\d/.test(x);
    const yNumeric = /^\d/.test(y);
    if (xNumeric && yNumeric) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y);
    } else if (xNumeric !== yNumeric) {
      return xNumeric ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return left.length - right.length;
}

function compare(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

/** Negative when `a` is older than `b`; versions that do not parse sort first. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return (left ? 1 : 0) - (right ? 1 : 0);
  return compare(left, right);
}

/** The newest release after `current`; someone on a stable version is offered stable releases only. */
export function pickUpdate(releases: readonly Release[], current: string): AvailableUpdate | null {
  const installed = parseVersion(current);
  if (!installed) return null;
  let newest: { version: Version; update: AvailableUpdate } | null = null;
  for (const release of releases) {
    const version = parseVersion(release.tag_name);
    if (release.draft || !version || !release.html_url.startsWith(RELEASES_URL)) continue;
    if (installed.prerelease === null && version.prerelease !== null) continue;
    if (compare(version, installed) <= 0) continue;
    if (newest && compare(version, newest.version) <= 0) continue;
    newest = { version, update: { version: formatVersion(version), url: release.html_url } };
  }
  return newest?.update ?? null;
}

/** Whether the notice for `update` shows: closing it hides that version, not the next one. */
export function isUpdateShown(update: AvailableUpdate | null, dismissed: string | null): update is AvailableUpdate {
  return update !== null && (dismissed === null || compareVersions(update.version, dismissed) > 0);
}

let lastList: { etag: string; releases: Release[] } | null = null;

/** Asks with the last list's ETag, so an unchanged list comes back as an empty 304. */
export async function fetchUpdate(current: string): Promise<AvailableUpdate | null> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (lastList) headers['If-None-Match'] = lastList.etag;
  const response = await fetch(RELEASES_API_URL, { headers, cache: 'no-store', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (response.status === 304 && lastList) return pickUpdate(lastList.releases, current);
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error('GitHub sent no release list');
  const releases = body.filter(isRelease).map(({ tag_name, html_url, draft }) => ({ tag_name, html_url, draft }));
  const etag = response.headers.get('ETag');
  lastList = etag ? { etag, releases } : null;
  return pickUpdate(releases, current);
}

function isRelease(value: unknown): value is Release {
  if (typeof value !== 'object' || value === null) return false;
  const release = value as Record<string, unknown>;
  return typeof release.tag_name === 'string' && typeof release.html_url === 'string' && typeof release.draft === 'boolean';
}
