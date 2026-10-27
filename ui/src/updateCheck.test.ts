import { afterEach, describe, expect, it, vi } from 'vitest';
import capability from '../../src-tauri/capabilities/default.json';
import tauriConfig from '../../src-tauri/tauri.conf.json';
import { RELEASES_API_URL, RELEASES_URL } from './build';
import { compareVersions, fetchUpdate, isUpdateShown, pickUpdate, type Release } from './updateCheck';

const release = (tag: string, extra: Partial<Release> = {}): Release => ({
  tag_name: tag,
  html_url: `${RELEASES_URL}tag/${tag}`,
  draft: false,
  ...extra,
});

describe('compareVersions', () => {
  it('orders numbered prereleases by number', () => {
    expect(compareVersions('0.1.0-beta10', '0.1.0-beta9')).toBeGreaterThan(0);
    expect(compareVersions('v0.1.0-beta8', '0.1.0-beta8')).toBe(0);
  });

  it('puts a release after its prereleases and before the next version', () => {
    expect(compareVersions('0.1.0', '0.1.0-beta8')).toBeGreaterThan(0);
    expect(compareVersions('0.1.1-beta1', '0.1.0')).toBeGreaterThan(0);
  });
});

describe('pickUpdate', () => {
  it('offers the newest release after the current one, in any order', () => {
    const releases = [release('v0.1.0-beta9'), release('v0.1.0-beta11'), release('v0.1.0-beta10'), release('v0.1.0-beta7')];
    expect(pickUpdate(releases, '0.1.0-beta8')).toEqual({ version: '0.1.0-beta11', url: `${RELEASES_URL}tag/v0.1.0-beta11` });
  });

  it('offers nothing when the current version is the newest', () => {
    expect(pickUpdate([release('v0.1.0-beta8'), release('v0.1.0-beta7')], '0.1.0-beta8')).toBeNull();
  });

  it('offers a stable release to someone on a prerelease', () => {
    expect(pickUpdate([release('v0.1.0')], '0.1.0-beta8')?.version).toBe('0.1.0');
  });

  it('offers no prerelease to someone on a stable version', () => {
    expect(pickUpdate([release('v0.2.0-beta1'), release('v0.1.1')], '0.1.0')?.version).toBe('0.1.1');
  });

  it('names the version without its build metadata', () => {
    expect(pickUpdate([release('v0.2.0+win')], '0.1.0')?.version).toBe('0.2.0');
  });

  it('skips drafts, odd tags and pages outside the releases', () => {
    const releases = [
      release('v0.2.0', { draft: true }),
      release('nightly'),
      release('v0.3.0', { html_url: 'https://example.test/v0.3.0' }),
    ];
    expect(pickUpdate(releases, '0.1.0')).toBeNull();
  });
});

describe('isUpdateShown', () => {
  const update = { version: '0.1.0-beta9', url: `${RELEASES_URL}tag/v0.1.0-beta9` };

  it('hides a closed version until a newer one comes out', () => {
    expect(isUpdateShown(update, null)).toBe(true);
    expect(isUpdateShown(update, '0.1.0-beta9')).toBe(false);
    expect(isUpdateShown({ ...update, version: '0.1.0-beta10' }, '0.1.0-beta9')).toBe(true);
  });
});

describe('fetchUpdate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks again with the last ETag and reuses the list GitHub reports unchanged', async () => {
    const list = JSON.stringify([release('v0.1.0-beta9')]);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(list, { headers: { ETag: 'W/"one"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    vi.stubGlobal('fetch', fetchMock);

    expect((await fetchUpdate('0.1.0-beta8'))?.version).toBe('0.1.0-beta9');
    expect((await fetchUpdate('0.1.0-beta8'))?.version).toBe('0.1.0-beta9');
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('If-None-Match')).toBe('W/"one"');
  });
});

describe('desktop app permissions', () => {
  it('let the app reach the releases of SOURCE_URL, so a fork has to update them along with it', () => {
    const opener = capability.permissions.find((permission) => typeof permission === 'object' && permission.identifier === 'opener:allow-open-url');
    expect(opener).toMatchObject({ allow: [{ url: `${RELEASES_URL}*` }] });
    const apiOrigin = new URL(RELEASES_API_URL).origin;
    expect(tauriConfig.app.security.csp).toContain(apiOrigin);
    expect(tauriConfig.app.security.devCsp).toContain(apiOrigin);
  });
});
