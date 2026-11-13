import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FightRow } from '../api/types';
import { groupPulls, groupRuns } from '../pulls/groupPulls';
import { compareLogFixture } from '../test/compareFixture';
import { runLogFixture } from '../test/runFixture';
import { PullList, RunCards } from './PullList';

vi.mock('../api/client', () => ({ api: {} }));

const [wipe, , kill] = compareLogFixture.fights;
const FIGHTS = [wipe, { ...wipe, index: 4 }, { ...kill, index: 5 }];

describe('pull list', () => {
  it('opens a set of pulls of a boss', async () => {
    const onOpenSet = vi.fn();
    render(<PullList groups={groupPulls(FIGHTS, true)} onOpen={() => {}} onOpenSet={onOpenSet} />);
    await userEvent.click(screen.getByRole('button', { name: "Open All wipes of Ula'tek (2 pulls)" }));
    expect(onOpenSet).toHaveBeenCalledWith({ kind: 'wipes', encounterId: 3492, difficulty: 15, fights: [1, 4] });
  });
});

describe('run cards', () => {
  const [run, dailcry, ...rest] = runLogFixture.fights;
  const trash = (index: number, name: string): FightRow => ({ ...dailcry, index, name, encounterId: 0, bossHpPercent: null, combat: { enemyCount: 1 } });
  const labels = () => screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'));

  it('run card folds consecutive trash into one row that expands to the pulls', async () => {
    const onOpen = vi.fn();
    render(<RunCards runs={groupRuns([run, dailcry, trash(10, 'Arathi Knight'), trash(11, 'Arathi Footman'), ...rest], true)} onOpen={onOpen} />);
    const fold = screen.getByRole('button', { name: '2 combat pulls' });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    expect(labels().slice(1, 4)).toEqual(['Open Captain Dailcry, pull 1 of the run', '2 combat pulls', 'Open Baron Braunpyke, pull 3 of the run']);

    fold.focus();
    await userEvent.keyboard('{Enter}');
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    expect(labels().slice(2, 6)).toEqual([
      '2 combat pulls',
      expect.stringMatching(/^Open combat pull Arathi Knight,/),
      expect.stringMatching(/^Open combat pull Arathi Footman,/),
      'Open Baron Braunpyke, pull 3 of the run',
    ]);
    await userEvent.click(screen.getByRole('button', { name: /^Open combat pull Arathi Footman/ }));
    expect(onOpen).toHaveBeenCalledWith(11);

    await userEvent.click(fold);
    expect(screen.queryByRole('button', { name: /^Open combat pull/ })).not.toBeInTheDocument();
  });

  it('shows a single combat pull between boss pulls as its own row', async () => {
    const onOpen = vi.fn();
    render(<RunCards runs={groupRuns([run, dailcry, trash(10, 'Arathi Knight'), ...rest], true)} onOpen={onOpen} />);
    expect(labels().slice(1, 4)).toEqual([
      'Open Captain Dailcry, pull 1 of the run',
      expect.stringMatching(/^Open combat pull Arathi Knight,/),
      'Open Baron Braunpyke, pull 3 of the run',
    ]);
    await userEvent.click(screen.getByRole('button', { name: /^Open combat pull Arathi Knight/ }));
    expect(onOpen).toHaveBeenCalledWith(10);
  });

  it('keeps the fold open when aborted pulls are shown', async () => {
    const short = { ...trash(10, 'Arathi Knight'), outcome: 'ended' as const, durationMs: 4_000 };
    const fights = [run, dailcry, short, trash(11, 'Arathi Footman'), trash(12, 'Arathi Footman'), ...rest];
    const { rerender } = render(<RunCards runs={groupRuns(fights, true)} onOpen={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: '2 combat pulls' }));

    rerender(<RunCards runs={groupRuns(fights, false)} onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: '3 combat pulls' })).toHaveAttribute('aria-expanded', 'true');
  });
});
