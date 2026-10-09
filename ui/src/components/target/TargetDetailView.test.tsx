import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { targetDetailFixture } from '../../test/reportFixtures';
import { TargetDetailView } from './TargetDetailView';

vi.mock('../../api/client', () => ({ api: {} }));

const openTarget = vi.fn(async () => {});
const openPlayer = vi.fn(async () => {});

beforeEach(() => {
  useApp.setState({ ...initialState(), openTarget, openPlayer });
  [openTarget, openPlayer].forEach((fn) => fn.mockClear());
});

describe('TargetDetailView', () => {
  it('switches to another enemy and opens a player from the damage by player', async () => {
    render(<TargetDetailView detail={targetDetailFixture} />);
    const enemies = within(screen.getByRole('group', { name: 'Enemies' })).getAllByRole('button');
    expect(enemies[1]).toHaveAttribute('aria-current', 'page');
    expect(enemies[1]).toHaveTextContent('Blightscale Rawling');
    await userEvent.click(enemies[2]);
    expect(openTarget).toHaveBeenCalledWith('Gore Rattle');
    await userEvent.click(screen.getByRole('button', { name: 'Faelan' }));
    expect(openPlayer).toHaveBeenCalledWith(4);
  });
});
