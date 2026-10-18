import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MAP_ART = { maps: { '2608': { zone: 16915, floor: 2, raid: true, minX: 265, maxX: 885, minY: -802.5, maxY: 127.5 } }, pins: { '3420': { uiMapId: 2609, u: 0.546, v: 0.724 } } };

const json = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });

describe('game data tables', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('loads the map art table once and retries a missing one', async () => {
    let mapArtAvailable = false;
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url);
        if (url.includes('manifest.json')) return json('{"fetchedUnixMs":1}');
        if (url.includes('map-art.json')) return mapArtAvailable ? json(JSON.stringify(MAP_ART)) : new Response('', { status: 404 });
        return new Response('', { status: 404 });
      }),
    );
    const { loadIconTables, iconTables } = await import('./gameData');
    const mapArtRequests = () => requested.filter((url) => url.includes('map-art.json')).length;

    loadIconTables();
    await vi.waitFor(() => expect(mapArtRequests()).toBe(1));
    await vi.advanceTimersByTimeAsync(1);
    expect(iconTables().mapArt).toBeNull();

    loadIconTables();
    await vi.advanceTimersByTimeAsync(1);
    expect(mapArtRequests(), 'not asked again before the retry delay').toBe(1);

    mapArtAvailable = true;
    await vi.advanceTimersByTimeAsync(30_000);
    loadIconTables();
    await vi.waitFor(() => expect(iconTables().mapArt).toEqual(MAP_ART));

    loadIconTables();
    await vi.advanceTimersByTimeAsync(1);
    expect(mapArtRequests(), 'a loaded table is kept').toBe(2);
  });
});
