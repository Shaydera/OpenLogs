import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { api } from '../api/client';
import { gameDataManifest } from '../gameData';
import { initialState, useApp } from '../store';
import { gameDataFixture } from '../test/gameDataFixture';

vi.mock('../api/client', () => ({
  api: { recentLogs: vi.fn(), openLog: vi.fn() },
}));
vi.mock('../gameData', () => ({ gameDataManifest: vi.fn() }));

beforeEach(() => {
  vi.mocked(api.recentLogs).mockReset().mockResolvedValue([]);
  vi.mocked(gameDataManifest).mockReset().mockResolvedValue(gameDataFixture);
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

  it('shows the game data the app ships with', async () => {
    const dialog = await openDialog();
    expect(await within(dialog).findByText('410,805 spells')).toBeInTheDocument();
    expect(within(dialog).getByText('From wago.tools as of Oct 11, 2026; updated with each release.')).toBeInTheDocument();
  });
});
