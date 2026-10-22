import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { DeathCutoffChip } from './DeathCutoffChip';

vi.mock('../../api/client', () => ({ api: {} }));

const raidLog = { fights: [{ index: 1, run: null }] } as never;
const overview = (cutoffMs: number | null, deaths = 0) =>
  ({ timeline: { durationMs: 300_000, cutoffMs, markers: { deaths: Array.from({ length: deaths }, (_, i) => ({ t: i * 1000, player: i })) } } }) as never;

beforeEach(() => {
  const setDeathCutoff = vi.fn(async (deathCutoff) => useApp.setState({ deathCutoff }));
  useApp.setState({ ...initialState(), log: raidLog, view: { kind: 'fight', fightIndex: 1 }, setDeathCutoff });
});

describe('DeathCutoffChip', () => {
  it('names the death and its time and clears the cutoff', async () => {
    useApp.setState({ deathCutoff: 3, overviewCutoff: 3, overview: overview(130_320) });
    render(<DeathCutoffChip />);
    expect(screen.getByText('Until the 3rd death')).toBeInTheDocument();
    expect(screen.getByText('2:10.3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show the whole pull' }));
    expect(useApp.getState().setDeathCutoff).toHaveBeenCalledWith(null);
  });

  it('says when the pull never reached that death', () => {
    useApp.setState({ deathCutoff: 5, overviewCutoff: 5, overview: overview(null, 4) });
    render(<DeathCutoffChip />);
    expect(screen.getByText('Until the 5th death · not reached')).toBeInTheDocument();
  });

  it('says nothing was cut when the death ends the pull', () => {
    useApp.setState({ deathCutoff: 5, overviewCutoff: 5, overview: overview(null, 5) });
    render(<DeathCutoffChip />);
    expect(screen.getByText('Until the 5th death · nothing cut')).toBeInTheDocument();
  });

  it('shows no time of an older cutoff while the new one loads', () => {
    useApp.setState({ deathCutoff: 5, overviewCutoff: 3, overview: overview(130_320) });
    render(<DeathCutoffChip />);
    expect(screen.getByText('Until the 5th death')).toBeInTheDocument();
    expect(screen.queryByText('2:10.3')).toBeNull();
  });

  it('counts only the cut pulls on a set', () => {
    const setPulls = Array.from({ length: 10 }, (_, i) => ({ fightIndex: i + 1, cutoffMs: i === 0 ? null : 60_000 })) as never;
    useApp.setState({ deathCutoff: 3, overviewCutoff: 3, view: { kind: 'set' } as never, overview: overview(null), setPulls });
    render(<DeathCutoffChip />);
    expect(screen.getByText('Each pull until its 3rd death')).toBeInTheDocument();
    expect(screen.getByText('9 of 10 pulls cut')).toBeInTheDocument();
  });

  it('renders nothing without a cutoff or on a whole run', () => {
    const { container, rerender } = render(<DeathCutoffChip />);
    expect(container).toBeEmptyDOMElement();
    useApp.setState({ deathCutoff: 2, overview: overview(1000), log: { fights: [{ index: 1, run: { key: 'r' } }] } as never });
    rerender(<DeathCutoffChip />);
    expect(container).toBeEmptyDOMElement();
  });
});
