import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { PullComparison } from '../../api/types';
import { type ComparisonState, initialState, useApp } from '../../store';
import { compareLogFixture, comparisonFixture } from '../../test/compareFixture';
import { PullComparisonView } from './PullComparisonView';

vi.mock('../../api/client', () => ({ api: { comparePulls: vi.fn() } }));

const OPEN: ComparisonState = { a: 1, b: 3, data: comparisonFixture, loading: false, error: null, reportAttribution: 'augmented', reportIncludeOverkill: false, reportDeathCutoff: null };
const KILL = compareLogFixture.fights[2];

const cells = (row: HTMLElement) => [...row.children].map((cell) => cell.textContent);

beforeEach(() => {
  useApp.setState({ ...initialState(), log: compareLogFixture, view: { kind: 'fight', fightIndex: 3 }, comparison: OPEN });
});

describe('PullComparisonView', () => {
  it('lists the key figures and the players of both pulls, with dashes for a missed pull', () => {
    render(<PullComparisonView row={KILL} />);
    const kpis = within(screen.getByRole('table', { name: 'Key figures' })).getAllByRole('row').map(cells);
    expect(kpis[0]).toEqual(['Figure', 'Pull #1', 'Pull #3', 'Difference']);
    expect(kpis[1]).toEqual(['Duration', '2:22', '7:58', '+5:36']);
    const players = within(screen.getByRole('table', { name: 'Players' })).getAllByRole('row').map(cells);
    expect(players).toEqual([
      ['Player', 'DPS #1', 'DPS #3', 'Δ DPS', 'HPS #1', 'HPS #3', 'Deaths #1', 'Deaths #3'],
      ['Faelan', '300k', '420k', '+120k', '—', '—', '0', '1'],
      ['Wendel', '280k', '250k', '−30.0k', '—', '—', '1', '1'],
      ['Pyrrin', '50.0k', '40.0k', '−10.0k', '210k', '250k', '0', '0'],
      ['Speronis', '200k', '—', '—', '—', '—', '0', '—'],
      ['Edrin', '—', '150k', '—', '—', '—', '—', '0'],
    ]);
  });

  it('recalculates in the other Aug mode and goes back to the pull', async () => {
    vi.mocked(api.comparePulls).mockReset().mockResolvedValue(comparisonFixture);
    render(<PullComparisonView row={KILL} />);
    await userEvent.click(within(screen.getByRole('group', { name: 'Aug support' })).getByRole('button', { name: 'Reattributed' }));
    expect(api.comparePulls).toHaveBeenLastCalledWith(compareLogFixture.id, 1, 3, 'reattributed', false, null);
    await userEvent.click(screen.getByRole('button', { name: '← Back to pull #3' }));
    expect(useApp.getState().comparison).toBeNull();
  });

  describe('with a death cutoff', () => {
    const phases = comparisonFixture.b.overview.timeline.phases;
    const cutB: PullComparison = {
      ...comparisonFixture,
      a: { ...comparisonFixture.a, overview: { ...comparisonFixture.a.overview, timeline: { ...comparisonFixture.a.overview.timeline, phases: phases.map((phase) => ({ ...phase, startMs: phase.startMs / 2 })) } } },
      b: { ...comparisonFixture.b, overview: { ...comparisonFixture.b.overview, timeline: { ...comparisonFixture.b.overview.timeline, cutoffMs: 200_000 } } },
    };

    it('names the cut of each pull in the header only while a cutoff is set', () => {
      useApp.setState({ comparison: { ...OPEN, data: cutB } });
      render(<PullComparisonView row={KILL} />);
      expect(screen.queryByText('Until the 3rd death')).toBeNull();
      act(() => useApp.setState({ deathCutoff: 3 }));
      expect(screen.getByText('Until the 3rd death')).toBeInTheDocument();
      expect(screen.getByText('#1 not reached · #3 3:20.0')).toBeInTheDocument();
    });

    it('greys the rest of the cut pull and leaves its later phases out of the difference', () => {
      useApp.setState({ deathCutoff: 3, comparison: { ...OPEN, data: cutB } });
      const { container } = render(<PullComparisonView row={KILL} />);
      expect(container.querySelectorAll('.cutoff-shade')).toHaveLength(2);
      const rows = within(screen.getByRole('table', { name: 'Phase start times' })).getAllByRole('row');
      const phase2 = rows.find((row) => row.firstElementChild?.textContent === 'Phase 2')!;
      expect(cells(phase2)).toEqual(['Phase 2', '2:00', '4:00', '—']);
      expect(within(phase2).getByTitle('After the 3rd death')).toHaveTextContent('4:00');
    });
  });
});
