import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { overviewFixture } from '../../test/overviewFixture';
import { buffsTimelineFixture, takenTimelineFixture, timelineFixture } from '../../test/viewFixtures';
import { TimelineView } from './TimelineView';

vi.mock('../../api/client', () => ({ api: {} }));

const refreshTimeline = vi.fn(async () => {});
const setLanes = vi.fn(async () => {});

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
    const hit = { kind: 'hit' as const, startMs: 125_000, source: 9, spellId: 1287012, target: 4 };
    useApp.setState({ tab: 'taken', timeline: { ...timelineFixture, lanes: [{ ...faelan, items: [hit] }, ...rest] } });
    render(<TimelineView tab="taken" />);
    const [bossCast, laneHit] = screen.getAllByRole('button', { name: /^Caustic Waves at 2:05/ });
    await userEvent.hover(laneHit);
    expect(within(screen.getByRole('tooltip')).getByText('Hit')).toBeInTheDocument();
    await userEvent.unhover(laneHit);
    await userEvent.hover(bossCast);
    expect(within(screen.getByRole('tooltip')).getByText('Boss cast with a cast time')).toBeInTheDocument();
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

  it('gives spell IDs of one name a single legend entry', () => {
    const [lane] = takenTimelineFixture.lanes;
    const sameName = { ...takenTimelineFixture.spells, '395153': { name: 'Caustic Waves' } };
    const items = lane.items.map((item) => (item.kind === 'aura' && item.spellId === 395152 ? { ...item, spellId: 395153 } : item));
    useApp.setState({ tab: 'taken', timeline: { ...takenTimelineFixture, spells: sameName, legend: [1287012, 395153], lanes: [{ ...lane, items }] } });
    render(<TimelineView tab="taken" />);
    const legend = screen.getByRole('list', { name: 'Debuffs drawn' });
    expect(within(legend).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Caustic Waves']);
  });
});
