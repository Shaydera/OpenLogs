import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { groupPulls } from '../pulls/groupPulls';
import { compareLogFixture } from '../test/compareFixture';
import { PullList } from './PullList';

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
