import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplayAura, ReplayData } from '../../api/types';
import { t } from '../../i18n/i18n';
import { initialState, useApp } from '../../store';
import { replayFixture } from '../../test/replayFixture';
import { indexHud } from './hudIndex';
import { RaidFrames } from './RaidFrames';

vi.mock('../../api/client', () => ({ api: {} }));

beforeEach(() => {
  useApp.setState({ ...initialState(), replay: { ...initialState().replay, time: 50_000 } });
});

const aura = (spellId: number, buff: boolean, raidFrame: number | null, startMs: number, endMs = 90_000): ReplayAura => ({
  target: 1,
  source: 10,
  spellId,
  buff,
  startMs,
  endMs,
  stacks: [],
  raidFrame,
});

describe('RaidFrames', () => {
  it('shows at most three debuffs and two buffs by priority', () => {
    const names = ['Rending Shadow', 'Grave Mark', 'Hollow Bite', 'Ashfall', 'Dread Echo', 'Old Wound', 'Shield Wall', 'Ironbark', 'Pain Suppression'];
    const data: ReplayData = {
      ...replayFixture,
      spells: Object.fromEntries(names.map((name, i) => [String(5000 + i), { name }])),
      auras: [
        aura(5000, false, 2, 10_000),
        aura(5001, false, 0, 20_000),
        aura(5002, false, 1, 30_000),
        aura(5003, false, 1, 40_000),
        aura(5004, false, null, 45_000),
        aura(5005, false, 0, 30_000, 45_000),
        aura(5006, true, 3, 5_000),
        aura(5007, true, 3, 45_000),
        aura(5008, true, 1, 1_000),
      ],
    };
    render(<RaidFrames hud={indexHud(data)} />);
    const frame = screen.getByRole('group', { name: 'Talwyn' });
    const shown = (list: string) => within(within(frame).getByRole('list', { name: list })).getAllByRole('img').map((icon) => icon.getAttribute('aria-label'));
    expect(shown(t('replay.debuffs'))).toEqual(['Grave Mark', 'Ashfall', 'Hollow Bite']);
    expect(shown(t('replay.buffs'))).toEqual(['Pain Suppression', 'Ironbark']);
  });

  it('a player without positions is marked', () => {
    render(<RaidFrames hud={indexHud(replayFixture)} />);
    expect(within(screen.getByRole('group', { name: 'Orsek' })).getByText(t('replay.noPosition'))).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Talwyn' })).queryByText(t('replay.noPosition'))).toBeNull();
  });

  it('clicking a frame selects the player and clicking it again clears the selection', async () => {
    render(<RaidFrames hud={indexHud(replayFixture)} />);
    const miravel = screen.getByRole('button', { name: 'Miravel' });
    await userEvent.click(miravel);
    expect(useApp.getState().replay.selected).toBe(2);
    expect(miravel).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(miravel);
    expect(useApp.getState().replay.selected).toBeNull();
    expect(miravel).toHaveAttribute('aria-pressed', 'false');
  });
});
