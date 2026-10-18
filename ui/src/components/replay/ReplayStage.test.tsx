import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapArtEntry, MapArtTable, ReplayData, ReplayTrack } from '../../api/types';
import { initialState, useApp } from '../../store';
import { replayFixture } from '../../test/replayFixture';
import { fitCamera, toScreen } from './camera';
import { ARENA_SIZE_YD, mapImageUrl, stageMap } from './mapArt';
import { ReplayStage } from './ReplayStage';
import { STAGE_PAD_PX } from './stageDraw';

vi.mock('../../api/client', () => ({ api: {} }));

const tables = vi.hoisted(() => ({ mapArt: null as MapArtTable | null }));
vi.mock('../../gameData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../gameData')>()),
  iconTables: () => ({ spells: null, portraits: null, mapArt: tables.mapArt }),
  loadIconTables: () => {},
  subscribeIconTables: () => () => {},
}));

const W = 640;
const H = 480;
const RAID_FLOOR = 2001;
const OTHER_FLOOR = 2002;
const UNLISTED_FLOOR = 2003;

const raidEntry = (floor: number): MapArtEntry => ({ zone: 17001, floor, raid: true, minX: 0, maxX: 400, minY: 0, maxY: 400 });
const still = (actor: number, x: number, y: number, map = RAID_FLOOR): ReplayTrack => ({ actor, t: [0, 1_000], x: [x, x], y: [y, y], facing: [0, 0], map: [map, map] });
const pull = (tracks: ReplayTrack[]): ReplayData => ({ ...replayFixture, tracks });

const context = document.createElement('canvas').getContext('2d') as unknown as Record<string, unknown>;
const drawImage = vi.fn();
const clearRect = vi.fn();
const mapImagesDrawn = () => drawImage.mock.calls.map(([image]) => (image as HTMLImageElement).src).filter((src) => src.includes('/maps/'));
const stage = () => screen.getByRole('application', { name: 'Replay stage' });

function imagesSettle(naturalWidth: number) {
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(naturalWidth);
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(naturalWidth);
}

async function nextFrameDrawn() {
  clearRect.mockClear();
  await vi.waitFor(() => expect(clearRect).toHaveBeenCalled());
}

beforeEach(() => {
  useApp.setState({ ...initialState(), tab: 'replay', replayData: replayFixture });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, W, H));
  tables.mapArt = null;
  context.drawImage = drawImage;
  context.clearRect = clearRect;
});
afterEach(() => {
  vi.restoreAllMocks();
  drawImage.mockReset();
  delete context.drawImage;
  delete context.clearRect;
});

describe('ReplayStage', () => {
  it('keeps Ctrl + wheel for itself at the zoom limit but leaves a plain wheel to the page', () => {
    render(<ReplayStage data={replayFixture} highlight={null} />);
    let clock = 0;
    const turn = (ctrlKey: boolean) => {
      clock += 10_000;
      const event = createEvent.wheel(stage(), { deltaY: 100, ctrlKey });
      Object.defineProperty(event, 'timeStamp', { value: clock });
      return fireEvent(stage(), event);
    };
    for (let i = 0; i < 40; i++) turn(false);
    expect(turn(false)).toBe(true);
    expect(turn(true)).toBe(false);
  });

  it('clicking a unit selects it', async () => {
    render(<ReplayStage data={replayFixture} highlight={null} />);
    const { frame } = stageMap(replayFixture, null);
    if (!frame) throw new Error('the fixture has positions');
    const [clientX, clientY] = toScreen(fitCamera(frame, W, H, STAGE_PAD_PX), 100, 200, W, H);
    await userEvent.pointer({ keys: '[MouseLeft]', target: stage(), coords: { clientX, clientY } });
    expect(useApp.getState().replay.selected).toBe(1);
  });

  it('re-fit returns to the arena frame', async () => {
    tables.mapArt = { maps: { [RAID_FLOOR]: raidEntry(1) }, pins: { [replayFixture.encounterId]: { uiMapId: RAID_FLOOR, u: 0.5, v: 0.5 } } };
    const data = pull([still(1, 230, 180), still(2, 190, 210)]);
    render(<ReplayStage data={data} highlight={null} />);
    const arena = { minX: 200 - ARENA_SIZE_YD / 2, maxX: 200 + ARENA_SIZE_YD / 2, minY: 200 - ARENA_SIZE_YD / 2, maxY: 200 + ARENA_SIZE_YD / 2 };
    const [clientX, clientY] = toScreen(fitCamera(arena, W, H, STAGE_PAD_PX), 230, 180, W, H);
    const selectsTank = async () => {
      useApp.getState().selectReplayUnit(null);
      await userEvent.pointer({ keys: '[MouseLeft]', target: stage(), coords: { clientX, clientY } });
      return useApp.getState().replay.selected === 1;
    };
    const drag = () => userEvent.pointer([{ keys: '[MouseLeft>]', target: stage(), coords: { clientX: 300, clientY: 300 } }, { coords: { clientX: 450, clientY: 260 } }, { keys: '[/MouseLeft]' }]);

    expect(await selectsTank(), 'opens on the arena').toBe(true);
    await drag();
    expect(await selectsTank(), 'moved away').toBe(false);
    await userEvent.dblClick(stage());
    expect(await selectsTank(), 'double click').toBe(true);
    await drag();
    stage().focus();
    await userEvent.keyboard('0');
    expect(await selectsTank(), 'key 0').toBe(true);
  });

  it('a pull switch drops the previous map image', async () => {
    imagesSettle(1024);
    tables.mapArt = { maps: { [RAID_FLOOR]: raidEntry(1) }, pins: {} };
    const { rerender } = render(<ReplayStage data={pull([still(1, 100, 200)])} highlight={null} />);
    await vi.waitFor(() => expect(mapImagesDrawn()).toContain(mapImageUrl(raidEntry(1))));

    rerender(<ReplayStage data={pull([still(1, 100, 200, UNLISTED_FLOOR)])} highlight={null} />);
    drawImage.mockClear();
    await nextFrameDrawn();
    expect(mapImagesDrawn()).toEqual([]);
  });

  it('names the units on another floor in its badge', async () => {
    tables.mapArt = { maps: { [RAID_FLOOR]: raidEntry(1), [OTHER_FLOOR]: raidEntry(2) }, pins: {} };
    render(<ReplayStage data={pull([still(1, 100, 200), still(2, 102, 202), still(3, 300, 300, OTHER_FLOOR)])} highlight={null} />);

    const badge = await screen.findByRole('note', { name: '1 on another floor: Orsek' });
    badge.focus();
    expect(badge).toHaveFocus();
  });

  it('tells two adds of one name apart in the badge', async () => {
    tables.mapArt = { maps: { [RAID_FLOOR]: raidEntry(1), [OTHER_FLOOR]: raidEntry(2) }, pins: {} };
    render(<ReplayStage data={pull([still(1, 100, 200), still(2, 102, 202), still(11, 300, 300, OTHER_FLOOR), still(12, 302, 302, OTHER_FLOOR)])} highlight={null} />);

    expect(await screen.findByRole('note', { name: '2 on another floor: Ashen Husk 1 · Ashen Husk 2' })).toBeInTheDocument();
  });

  it('following a unit on another floor keeps the camera where it is', async () => {
    const data = pull([still(1, 100, 200), still(2, 110, 210), still(3, 300, 300, OTHER_FLOOR)]);
    useApp.setState({ replay: { ...useApp.getState().replay, selected: 3, follow: true } });
    render(<ReplayStage data={data} highlight={null} />);
    const { frame } = stageMap(data, null);
    if (!frame) throw new Error('the pull has positions');
    const [clientX, clientY] = toScreen(fitCamera(frame, W, H, STAGE_PAD_PX), 100, 200, W, H);

    await userEvent.pointer({ keys: '[MouseLeft]', target: stage(), coords: { clientX, clientY } });
    expect(useApp.getState().replay.selected).toBe(1);
  });

  it('hints at a missing map only when its image failed to load', async () => {
    imagesSettle(0);
    tables.mapArt = { maps: { [RAID_FLOOR]: raidEntry(1) }, pins: {} };
    const { rerender } = render(<ReplayStage data={pull([still(1, 100, 200, UNLISTED_FLOOR)])} highlight={null} />);
    await nextFrameDrawn();
    expect(screen.queryByText('Map not available'), 'a floor without art').toBeNull();

    rerender(<ReplayStage data={pull([still(1, 100, 200)])} highlight={null} />);
    expect(await screen.findByText('Map not available')).toBeInTheDocument();
  });
});
