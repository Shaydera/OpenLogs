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

  it('asks for no Forever table when the export has none', async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url);
        if (url.includes('manifest.json')) return json('{"fetchedUnixMs":1}');
        return json('{}');
      }),
    );
    const { spellClassesJson } = await import('./gameData');

    expect(await spellClassesJson('forever')).toBeNull();
    expect(requested.filter((url) => url.includes('forever/'))).toEqual([]);
  });

  it('reads the Forever tables from their own directory', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('manifest.json')) return json('{"fetchedUnixMs":1,"forever":{"build":"1.60.1.71037","spellIcons":1,"channelSpells":1,"spellClasses":1}}');
        if (url.includes('forever/spell-classes.json')) return json('forever classes');
        if (url.includes('spell-classes.json')) return json('retail classes');
        return new Response('', { status: 404 });
      }),
    );
    const { spellClassesJson } = await import('./gameData');

    expect(await spellClassesJson('forever')).toBe('forever classes');
    expect(await spellClassesJson('retail')).toBe('retail classes');
  });

  it('shows the spell icons of the game of the open log', async () => {
    const icons = (name: string) => json(JSON.stringify({ ids: [5487], icons: [0], names: [name] }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('manifest.json')) return json('{"fetchedUnixMs":1,"forever":{"build":"1.60.1.71037","spellIcons":1,"channelSpells":1,"spellClasses":1}}');
        if (url.includes('forever/spell-icons.json')) return icons('ability_racial_bearform');
        if (url.includes('spell-icons.json')) return icons('retail_icon');
        return new Response('', { status: 404 });
      }),
    );
    const { setCurrentLog } = await import('./currentGame');
    const { iconTables, loadIconTables, spellIconName, subscribeIconTables } = await import('./gameData');
    const bearForm = () => {
      const spells = iconTables().spells;
      return spells && spellIconName(spells, 5487);
    };
    const notified = vi.fn();
    subscribeIconTables(notified);

    setCurrentLog({ game: { kind: 'forever' }, dataGame: 'forever' });
    loadIconTables();
    await vi.waitFor(() => expect(bearForm()).toBe('ability_racial_bearform'));

    notified.mockClear();
    setCurrentLog({ game: { kind: 'retail' }, dataGame: 'retail' });
    expect(notified).toHaveBeenCalled();
    await vi.waitFor(() => expect(bearForm()).toBe('retail_icon'));

    setCurrentLog({ game: { kind: 'forever' }, dataGame: 'forever' });
    expect(bearForm(), 'a loaded table is shown again at once').toBe('ability_racial_bearform');
  });

  it('leaves the icons alone when a refreshed log keeps its game', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    const { setCurrentLog } = await import('./currentGame');
    const { iconTables, subscribeIconTables } = await import('./gameData');
    setCurrentLog({ game: { kind: 'forever' }, dataGame: 'forever' });
    const shown = iconTables();
    const notified = vi.fn();
    subscribeIconTables(notified);

    setCurrentLog({ game: { kind: 'forever' }, dataGame: 'forever' });

    expect(notified).not.toHaveBeenCalled();
    expect(iconTables()).toBe(shown);
  });
});
