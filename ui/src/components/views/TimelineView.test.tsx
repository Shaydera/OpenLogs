import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerRef, UnitRef, TimelineItem, TimelineLane } from '../../api/types';
import { initialState, useApp } from '../../store';
import { overviewFixture } from '../../test/overviewFixture';
import { buffsTimelineFixture, resourcesTimelineFixture, takenTimelineFixture, timelineFixture } from '../../test/viewFixtures';
import { TimelineView } from './TimelineView';
import { timeAtX, windowSpan } from './zoomGeometry';

vi.mock('../../api/client', () => ({ api: {} }));

const refreshTimeline = vi.fn(async () => {});
const setLanes = vi.fn(async () => {});
const setViewToggle = vi.fn(async () => {});

beforeEach(() => {
  refreshTimeline.mockClear();
  setLanes.mockClear();
  useApp.setState({
    ...initialState(),
    tab: 'casts',
    reportView: 'timeline',
    overview: overviewFixture,
    timeline: timelineFixture,
    zoom: { startMs: 120_000, endMs: 140_000 },
    refreshTimeline,
    setLanes,
    setViewToggle,
    filterOptions: vi.fn(async () => []),
  });
});

const zoom = () => useApp.getState().zoom;

describe('TimelineView', () => {
  it('zooms by length, by a drag across the ruler and pans by half a window', async () => {
    render(<TimelineView tab="casts" />);
    expect(screen.getByText('2:00 – 2:20 · 20 s')).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('group', { name: 'Window length' })).getByRole('button', { name: '10 s' }));
    expect(zoom()).toEqual({ startMs: 125_000, endMs: 135_000 });
    await userEvent.click(screen.getByRole('button', { name: 'Earlier' }));
    expect(zoom()).toEqual({ startMs: 120_000, endMs: 130_000 });
    const ruler = screen.getByTestId('timeline-ruler');
    vi.spyOn(ruler, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1_000, 30));
    fireEvent.mouseDown(ruler, { button: 0, clientX: 250 });
    fireEvent.mouseMove(document, { clientX: 750 });
    fireEvent.mouseUp(document, { clientX: 750 });
    expect(zoom()).toEqual({ startMs: 122_500, endMs: 127_500 });
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    expect(refreshTimeline).toHaveBeenCalled();
  });

  it('the ruler click sets the replay time in the split', () => {
    useApp.setState({ replay: { ...initialState().replay, split: true } });
    render(<TimelineView tab="casts" />);
    const ruler = screen.getByTestId('timeline-ruler');
    vi.spyOn(ruler, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1_000, 30));
    fireEvent.mouseDown(ruler, { button: 0, clientX: 250 });
    fireEvent.mouseMove(document, { clientX: 252 });
    fireEvent.mouseUp(document, { clientX: 252 });
    expect(useApp.getState().replay.time).toBe(125_000);
    expect(zoom()).toEqual({ startMs: 120_000, endMs: 140_000 });
  });

  it('a mark click in the split sets the replay time, a death five seconds early, and pins the card', async () => {
    useApp.setState({ tab: 'taken', timeline: takenTimelineFixture, replay: { ...initialState().replay, split: true } });
    render(<TimelineView tab="taken" />);
    await userEvent.click(screen.getByRole('button', { name: 'Wendel died at 2:15' }));
    expect(useApp.getState().replay.time).toBe(130_000);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  describe('pointer gestures on the tracks', () => {
    const mark = () => screen.getByRole('button', { name: 'Arcane Blast at 2:08 by Faelan' });
    const press = (target: Element, x: number) => fireEvent.pointerDown(target, { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: 10 });
    const moveTo = (target: Element, x: number) => fireEvent.pointerMove(target, { pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: x, clientY: 10 });
    const release = (target: Element, x: number) => fireEvent.pointerUp(target, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: 10 });
    const finger = (pointerId: number) => ({
      down: (target: Element, x: number) => fireEvent.pointerDown(target, { pointerId, pointerType: 'touch', isPrimary: pointerId === 1, buttons: 1, clientX: x, clientY: 10 }),
      move: (target: Element, x: number) => fireEvent.pointerMove(target, { pointerId, pointerType: 'touch', isPrimary: pointerId === 1, buttons: 1, clientX: x, clientY: 10 }),
      up: (target: Element, x: number) => fireEvent.pointerUp(target, { pointerId, pointerType: 'touch', isPrimary: pointerId === 1, clientX: x, clientY: 10 }),
    });

    beforeEach(() => {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1_000, 36));
      Object.defineProperty(Element.prototype, 'setPointerCapture', { value: () => {}, configurable: true });
    });
    afterEach(() => {
      vi.restoreAllMocks();
      delete (Element.prototype as Partial<Element>).setPointerCapture;
    });

    it('zooms with the wheel around the pointer and leaves the wheel over the lane names to the page', () => {
      render(<TimelineView tab="casts" />);
      expect(fireEvent.wheel(screen.getByText('Faelan'), { deltaY: -100, clientX: 250 })).toBe(true);
      expect(zoom()).toEqual({ startMs: 120_000, endMs: 140_000 });
      expect(fireEvent.wheel(mark(), { deltaY: -100, clientX: 250 })).toBe(false);
      expect(windowSpan(zoom()!)).toBeLessThan(20_000);
      expect(timeAtX(250, 1_000, zoom()!)).toBeCloseTo(125_000, -1);
    });

    it('leaves the wheel to the page when the whole range is shown and the wheel turns out', async () => {
      render(<TimelineView tab="casts" />);
      await userEvent.click(screen.getByRole('button', { name: 'Range' }));
      expect(fireEvent.wheel(mark(), { deltaY: 100, clientX: 250 })).toBe(true);
      expect(fireEvent.wheel(mark(), { deltaY: -100, clientX: 250 })).toBe(false);
    });

    it('keeps the wheel through a turn that reaches the zoom limit and leaves a fresh turn there to the page', async () => {
      useApp.setState({ zoom: { startMs: 126_000, endMs: 131_000 } });
      render(<TimelineView tab="casts" />);
      expect(fireEvent.wheel(mark(), { deltaY: -400, clientX: 500 })).toBe(false);
      expect(windowSpan(zoom()!)).toBe(2_500);
      expect(fireEvent.wheel(mark(), { deltaY: -100, clientX: 500 })).toBe(false);
      await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
      expect(fireEvent.wheel(mark(), { deltaY: -100, clientX: 500 })).toBe(true);
    });

    it('moves the window earlier with a drag to the right, pins no card and asks for the timeline once for the burst', async () => {
      render(<TimelineView tab="casts" />);
      press(mark(), 500);
      for (const x of [520, 560, 600]) moveTo(mark(), x);
      release(mark(), 600);
      fireEvent.click(mark());
      expect(zoom()).toEqual({ startMs: 118_000, endMs: 138_000 });
      expect(screen.queryByRole('dialog')).toBeNull();
      await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
      expect(refreshTimeline).toHaveBeenCalledTimes(1);
    });

    it('pins the card on a click that barely moves', () => {
      render(<TimelineView tab="casts" />);
      press(mark(), 500);
      moveTo(mark(), 502);
      release(mark(), 502);
      fireEvent.click(mark());
      expect(zoom()).toEqual({ startMs: 120_000, endMs: 140_000 });
      expect(screen.getByRole('dialog', { name: 'Arcane Blast' })).toBeInTheDocument();
    });

    it("stops a drag at the pull's start and end", () => {
      render(<TimelineView tab="casts" />);
      const track = mark().parentElement!;
      press(track, 500);
      moveTo(track, 10_500);
      expect(zoom()).toEqual({ startMs: 0, endMs: 20_000 });
      moveTo(track, -30_000);
      expect(zoom()).toEqual({ startMs: 458_610, endMs: 478_610 });
      release(track, -30_000);
    });

    it('keeps the span of a window dragged against either end of the pull', () => {
      render(<TimelineView tab="casts" />);
      const track = mark().parentElement!;
      act(() => useApp.setState({ zoom: { startMs: 0, endMs: 30_000 } }));
      press(track, 500);
      for (const x of [520, 600, 800]) moveTo(track, x);
      release(track, 800);
      expect(zoom()).toEqual({ startMs: 0, endMs: 30_000 });
      act(() => useApp.setState({ zoom: { startMs: 448_610, endMs: 478_610 } }));
      press(track, 500);
      for (const x of [480, 300, 100]) moveTo(track, x);
      release(track, 100);
      expect(zoom()).toEqual({ startMs: 448_610, endMs: 478_610 });
    });

    it('drags with one finger even after a touch whose release never came', () => {
      render(<TimelineView tab="casts" />);
      const track = mark().parentElement!;
      act(() => useApp.setState({ zoom: { startMs: 0, endMs: 30_000 } }));
      finger(7).down(track, 300);
      finger(1).down(track, 500);
      for (const x of [520, 600, 800]) finger(1).move(track, x);
      finger(1).up(track, 800);
      expect(zoom()).toEqual({ startMs: 0, endMs: 30_000 });
    });

    it('swallows the late click of a short touch drag', async () => {
      render(<TimelineView tab="casts" />);
      finger(1).down(mark(), 500);
      finger(1).move(mark(), 508);
      finger(1).up(mark(), 508);
      await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
      fireEvent.click(mark());
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('stops a mouse drag whose release was missed', () => {
      render(<TimelineView tab="casts" />);
      press(mark(), 500);
      moveTo(mark(), 600);
      fireEvent.pointerMove(mark(), { pointerId: 1, pointerType: 'mouse', buttons: 0, clientX: 700, clientY: 10 });
      fireEvent.pointerMove(mark(), { pointerId: 1, pointerType: 'mouse', buttons: 0, clientX: 800, clientY: 10 });
      expect(zoom()).toEqual({ startMs: 118_000, endMs: 138_000 });
    });

    it('pinches with two fingers and pans on with the one left', () => {
      render(<TimelineView tab="casts" />);
      const track = mark().parentElement!;
      finger(1).down(track, 400);
      finger(2).down(track, 600);
      finger(2).move(track, 700);
      expect(windowSpan(zoom()!)).toBeLessThan(20_000);
      finger(2).up(track, 700);
      const pinched = zoom()!;
      finger(1).move(track, 500);
      expect(windowSpan(zoom()!)).toBe(windowSpan(pinched));
      expect(zoom()!.startMs).toBeLessThan(pinched.startMs);
      finger(1).up(track, 500);
    });
  });

  it('describes a cast with a cast time: what, who and whom, when, how long, how much and its log lines', async () => {
    render(<TimelineView tab="casts" />);
    await userEvent.hover(screen.getByRole('button', { name: 'Arcane Blast at 2:08 by Faelan' }));
    const tip = screen.getByRole('tooltip');
    expect(within(tip).getByText('Cast with a cast time')).toBeInTheDocument();
    expect(within(tip).getByText(/Faelan/)).toHaveTextContent("Faelan → Ula'tek #1");
    expect(within(tip).getByText('2:08.000 → 2:09.200')).toBeInTheDocument();
    expect(within(tip).getByText('Cast time 1.20 s')).toBeInTheDocument();
    expect(within(tip).getByText('1.06M damage in 1 hit on 1 target · incl. 62.00k Aug support')).toBeInTheDocument();
    expect(within(tip).getByText('until the next cast of the same spell (15 s max)')).toBeInTheDocument();
    expect(within(tip).getByText('SPELL_CAST_START')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Arcane Blast at 2:08 by Faelan' }));
    const pinned = screen.getByRole('dialog', { name: 'Arcane Blast' });
    await userEvent.click(within(pinned).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Arcane Blast' })).toBeNull();
  });

  it('pins a card from the keyboard on its close button and gives the focus back on Escape', async () => {
    render(<TimelineView tab="casts" />);
    const mark = screen.getByRole('button', { name: 'Arcane Blast at 2:08 by Faelan' });
    mark.focus();
    await userEvent.keyboard('{Enter}');
    expect(within(screen.getByRole('dialog', { name: 'Arcane Blast' })).getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mark).toHaveFocus();
  });

  it('tells a boss cast of the context lane from a hit of the same spell at the same time', async () => {
    const [faelan, ...rest] = timelineFixture.lanes;
    const hit = { kind: 'hit' as const, startMs: 125_000, spanEndMs: 125_000, source: 9, spellId: 1287012, target: 4 };
    useApp.setState({ tab: 'taken', timeline: { ...timelineFixture, lanes: [{ ...faelan, items: [hit] }, ...rest] } });
    render(<TimelineView tab="taken" />);
    const [bossCast, laneHit] = screen.getAllByRole('button', { name: /^Caustic Waves at 2:05/ });
    await userEvent.hover(laneHit);
    expect(within(screen.getByRole('tooltip')).getByText('Hit')).toBeInTheDocument();
    await userEvent.unhover(laneHit);
    await userEvent.hover(bossCast);
    expect(within(screen.getByRole('tooltip')).getByText('Boss cast with a cast time')).toBeInTheDocument();
  });

  it('draws a channel solid to its last tick and hatched to its logged end, with a mark per tick', () => {
    const [faelan, ...rest] = timelineFixture.lanes;
    const cast = { source: 4, target: 9, spellId: 15407 };
    const items: TimelineItem[] = [
      { ...cast, kind: 'channel', startMs: 121_000, spanEndMs: 122_400, channel: { endMs: 122_400, lastTickMs: 122_000, ticks: [121_500, 122_000] } },
      { ...cast, kind: 'channel', startMs: 123_000, spanEndMs: 124_000, channel: { endMs: 124_000, lastTickMs: 124_000, ticks: [123_500, 124_000] } },
      { ...cast, kind: 'channel', startMs: 124_500, spanEndMs: 125_500, channel: { lastTickMs: 125_500, ticks: [125_000, 125_500] } },
    ];
    const spells = { ...timelineFixture.spells, '15407': { name: 'Mind Flay' } };
    useApp.setState({ timeline: { ...timelineFixture, spells, lanes: [{ ...faelan, items }, ...rest] } });
    render(<TimelineView tab="casts" />);
    expect(screen.getAllByRole('button', { name: /^Mind Flay at/ })).toHaveLength(3);
    expect(screen.getAllByTestId('channel-tail')).toHaveLength(1);
    expect(screen.getAllByTestId('channel-tick')).toHaveLength(6);
  });

  it('draws the lanes of the chosen dimension and lets the user pick another', async () => {
    render(<TimelineView tab="casts" />);
    expect(screen.getByText('Faelan')).toBeInTheDocument();
    expect(screen.getByText('Encounter casts')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Lanes/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Casts by Ability' }));
    expect(setLanes).toHaveBeenCalledWith('ability');
  });

  it("keeps the timeline while it loads and shows the view's failure, not the table's", () => {
    useApp.setState({ viewLoading: true, reportError: 'table failed' });
    render(<TimelineView tab="casts" />);
    expect(screen.getByRole('status')).toHaveTextContent('Calculating…');
    expect(screen.getByText('Faelan').closest('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => useApp.setState({ viewLoading: false, viewError: 'timeline failed' }));
    expect(screen.getByRole('alert')).toHaveTextContent('timeline failed');
    expect(screen.getByText('Faelan')).toBeInTheDocument();
  });

  it("draws each aura bar on its sub-track and opens the ones past the eighth", async () => {
    useApp.setState({ tab: 'buffs', timeline: buffsTimelineFixture });
    render(<TimelineView tab="buffs" />);
    const bars = () => screen.getAllByRole('button', { name: /^Ebon Might at/ });
    expect(bars()).toHaveLength(8);
    await userEvent.click(screen.getByRole('button', { name: '+2 more tracks' }));
    expect(bars()).toHaveLength(10);
    expect(screen.getByRole('button', { name: '− hide 2 tracks' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens the hidden sub-tracks of the single selection lane too', async () => {
    const [lane] = buffsTimelineFixture.lanes;
    useApp.setState({ tab: 'buffs', timeline: { ...buffsTimelineFixture, axis: null, lanes: [{ ...lane, key: null }] } });
    render(<TimelineView tab="buffs" />);
    expect(screen.getAllByRole('button', { name: /^Ebon Might at/ })).toHaveLength(8);
    await userEvent.click(screen.getByRole('button', { name: '+2 more tracks' }));
    expect(screen.getAllByRole('button', { name: /^Ebon Might at/ })).toHaveLength(10);
  });

  it("lists Damage Taken's debuffs in the head in order of appearance", () => {
    useApp.setState({ tab: 'taken', timeline: takenTimelineFixture });
    render(<TimelineView tab="taken" />);
    const legend = screen.getByRole('list', { name: 'Debuffs drawn' });
    expect(within(legend).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Caustic Waves', 'Ebon Might']);
    expect(screen.getByRole('button', { name: 'Wendel died at 2:15' })).toBeInTheDocument();
  });

  it("lists no debuffs when the window draws none and passes the head's Hits chip to the store", async () => {
    const [lane] = takenTimelineFixture.lanes;
    useApp.setState({ tab: 'taken', timeline: { ...takenTimelineFixture, lanes: [{ ...lane, items: lane.items.filter((item) => item.kind !== 'aura') }] } });
    render(<TimelineView tab="taken" />);
    expect(screen.queryByRole('list', { name: 'Debuffs drawn' })).toBeNull();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Hits' }));
    expect(setViewToggle).toHaveBeenCalledWith('hits', true);
  });

  it('lists only the debuffs with a bar in the shown window', () => {
    useApp.setState({ tab: 'taken', timeline: takenTimelineFixture, zoom: { startMs: 130_000, endMs: 135_000 } });
    render(<TimelineView tab="taken" />);
    const legend = screen.getByRole('list', { name: 'Debuffs drawn' });
    expect(within(legend).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Ebon Might']);
  });

  it('lists no debuffs when none has a bar in the shown window', () => {
    useApp.setState({ tab: 'taken', timeline: takenTimelineFixture, zoom: { startMs: 0, endMs: 30_000 } });
    render(<TimelineView tab="taken" />);
    expect(screen.queryByRole('list', { name: 'Debuffs drawn' })).toBeNull();
  });

  it('gives spell IDs of one name a single legend entry', () => {
    const [lane] = takenTimelineFixture.lanes;
    const sameName = { ...takenTimelineFixture.spells, '395153': { name: 'Caustic Waves' } };
    const items = lane.items.map((item) => (item.kind === 'aura' && item.spellId === 395152 ? { ...item, spellId: 395153 } : item));
    useApp.setState({ tab: 'taken', timeline: { ...takenTimelineFixture, spells: sameName, legend: [1287012, 395153], lanes: [{ ...lane, items }] } });
    render(<TimelineView tab="taken" />);
    const legend = screen.getByRole('list', { name: 'Debuffs drawn' });
    expect(within(legend).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Caustic Waves']);
  });

  it("draws a unit's power and health as logged and reads the value under the pointer, also after a pan", async () => {
    useApp.setState({ tab: 'resources', timeline: resourcesTimelineFixture });
    render(<TimelineView tab="resources" />);
    const health = screen.getByRole('img', { name: 'Health, lowest 0 / 1.00M (0.0%) at 2:12.000' });
    vi.spyOn(health, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1_000, 40));
    fireEvent.mouseMove(health, { clientX: 575 });
    expect(screen.getByText('Health 400.00k / 1.00M (40.0%) at 2:11.000')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Mana, lowest/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.getByText('Health 0 / 1.00M (0.0%) at 2:12.000')).toBeInTheDocument();
    fireEvent.mouseMove(health, { clientX: 150 });
    expect(screen.getByText('Health 0 / 1.00M (0.0%) at 2:12.000 · dead')).toBeInTheDocument();
  });

  it('draws rage in game units', () => {
    const [lane] = resourcesTimelineFixture.lanes;
    const power = [{ powerType: 1, samples: [[118_000, 1300, 1300] as [number, number, number], [125_000, 500, 1300] as [number, number, number]] }];
    useApp.setState({ tab: 'resources', timeline: { ...resourcesTimelineFixture, lanes: [{ ...lane, power }] } });
    render(<TimelineView tab="resources" />);
    expect(screen.getByRole('img', { name: 'Rage, lowest 50 / 130 (38.5%) at 2:05.000' })).toBeInTheDocument();
  });

  describe('Resources lanes', () => {
    const [faelan] = resourcesTimelineFixture.lanes;
    const lane = (unit: UnitRef, name: string, number: number | null = null, boss = false): TimelineLane => ({
      ...faelan,
      key: { kind: 'unit', unit },
      name,
      number,
      boss,
    });
    const shown = (names: RegExp) => screen.getAllByText(names).map((element) => element.textContent);

    it('orders the players by role, then by name', () => {
      const lirael: PlayerRef = { actorId: 6, name: 'Lirael-Emberfall-EU', specId: 65, specName: 'Holy Paladin', classId: 2, classToken: 'PALADIN', role: 'healer' };
      const lanes = [lane({ kind: 'player', actorId: 3 }, 'Wendel'), lane({ kind: 'player', actorId: 4 }, 'Faelan'), lane({ kind: 'player', actorId: 6 }, 'Lirael')];
      useApp.setState({ tab: 'resources', timeline: { ...resourcesTimelineFixture, roster: [...resourcesTimelineFixture.roster, lirael], lanes } });
      render(<TimelineView tab="resources" />);
      expect(shown(/^(Faelan|Lirael|Wendel)$/)).toEqual(['Lirael', 'Faelan', 'Wendel']);
    });

    it('puts the boss on top and folds the units of a shared name into a group that opens', async () => {
      const lanes = [
        lane({ kind: 'instance', actorId: 11 }, 'Blightscale Rawling', 2),
        lane({ kind: 'instance', actorId: 12 }, 'Venom Spitter'),
        lane({ kind: 'instance', actorId: 9 }, "Ula'tek", 1, true),
        lane({ kind: 'instance', actorId: 10 }, 'Blightscale Rawling', 1),
      ];
      useApp.setState({ tab: 'resources', timeline: { ...resourcesTimelineFixture, lanes } });
      render(<TimelineView tab="resources" />);
      expect(shown(/^(Ula'tek #1|Blightscale Rawling|Venom Spitter)$/)).toEqual(["Ula'tek #1", 'Blightscale Rawling', 'Venom Spitter']);
      expect(screen.getByText('· 2')).toBeInTheDocument();
      const group = screen.getByRole('button', { name: 'Blightscale Rawling · 2' });
      expect(group).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('#1')).toBeNull();
      await userEvent.click(group);
      expect(group).toHaveAttribute('aria-expanded', 'true');
      expect(shown(/^#\d$/)).toEqual(['#1', '#2']);
    });

    it('opens the group the lens picks by its name', () => {
      const lanes = [lane({ kind: 'instance', actorId: 10 }, 'Blightscale Rawling', 1), lane({ kind: 'instance', actorId: 11 }, 'Blightscale Rawling', 2)];
      const filters = { perspective: 'enemy' as const, own: [{ kind: 'unit' as const, name: 'Blightscale Rawling' }], other: [], ability: [] };
      useApp.setState({ tab: 'resources', filters, timeline: { ...resourcesTimelineFixture, lanes } });
      render(<TimelineView tab="resources" />);
      expect(screen.getByRole('button', { name: 'Blightscale Rawling · 2' })).toHaveAttribute('aria-expanded', 'true');
      expect(shown(/^#\d$/)).toEqual(['#1', '#2']);
    });
  });
});
