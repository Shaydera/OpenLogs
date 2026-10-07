import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { api } from '../api/client';
import type { GameDataStatus } from '../api/types';
import { initialState, useApp } from '../store';
import { gameDataFixture } from '../test/gameDataFixture';

vi.mock('../api/client', () => ({
  api: { recentLogs: vi.fn(), openLog: vi.fn(), gameDataStatus: vi.fn(), refreshGameData: vi.fn() },
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: vi.fn().mockResolvedValue(() => {}) }),
}));

beforeEach(() => {
  vi.mocked(api.recentLogs).mockReset().mockResolvedValue([]);
  vi.mocked(api.gameDataStatus).mockReset().mockResolvedValue(gameDataFixture);
  vi.mocked(api.refreshGameData).mockReset();
  localStorage.clear();
  useApp.setState(initialState());
});

async function openDialog() {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
  return screen.findByRole('dialog', { name: 'Settings' });
}

describe('Settings dialog', () => {
  it('changes the persisted preferences', async () => {
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByLabelText('Show Aug Δ column'));
    await userEvent.click(within(dialog).getByLabelText('Hide aborted pulls (< 10 s)'));
    expect(useApp.getState()).toMatchObject({ showAugDelta: true, hideAborted: false });
    expect(localStorage.getItem('openlogs.showAugDelta')).toBe('true');
  });

  it('refreshes the game data on request', async () => {
    let finish: (status: GameDataStatus) => void = () => {};
    vi.mocked(api.refreshGameData).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const dialog = await openDialog();
    await within(dialog).findAllByRole('listitem');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Refresh now' }));
    expect(within(dialog).getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
    finish({
      ...gameDataFixture,
      bossPortraits: { entries: 1_157, fetchedUnixMs: new Date(2026, 9, 12, 9, 0).getTime(), error: null },
    });
    expect(await within(dialog).findByText('1,157 bosses · updated Oct 12, 2026')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Refresh now' })).toBeEnabled();
  });
});
