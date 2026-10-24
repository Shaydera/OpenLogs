import { fireEvent, render, screen, within } from '@testing-library/react';
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
const build = vi.hoisted(() => ({ IS_WEBSITE: false, PRIVACY_NOTICE_URL: undefined as string | undefined }));
vi.mock('../build', () => build);

beforeEach(() => {
  build.IS_WEBSITE = false;
  build.PRIVACY_NOTICE_URL = undefined;
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
  it('applies and remembers the chosen theme', async () => {
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Bark & Paper' }));
    expect(document.documentElement.dataset.theme).toBe('bark');
    expect(localStorage.getItem('openlogs.theme')).toBe('bark');
  });

  it('shows the game data the app ships with', async () => {
    const dialog = await openDialog();
    expect(await within(dialog).findByText('410,805 spells')).toBeInTheDocument();
    expect(within(dialog).getByText('From wago.tools as of Oct 11, 2026; updated with each release.')).toBeInTheDocument();
  });

  it('leaves out a table an older export does not have', async () => {
    vi.mocked(gameDataManifest).mockResolvedValue({ ...gameDataFixture, channelSpells: undefined });
    const dialog = await openDialog();
    expect(await within(dialog).findByText('410,805 spells')).toBeInTheDocument();
    expect(within(dialog).queryByText('Channel spells')).toBeNull();
  });

  describe('privacy', () => {
    it("links the deployment's privacy notice on the website", async () => {
      build.IS_WEBSITE = true;
      build.PRIVACY_NOTICE_URL = 'https://example.test/privacy';
      const dialog = await openDialog();
      expect(within(dialog).getByRole('link', { name: 'Privacy notice' })).toHaveAttribute('href', 'https://example.test/privacy');
    });

    it('links no notice from a website build that names none', async () => {
      build.IS_WEBSITE = true;
      const dialog = await openDialog();
      expect(within(dialog).queryByRole('link', { name: 'Privacy notice' })).toBeNull();
    });
  });

  describe('UI size', () => {
    it('reads out the automatic and the resulting size', async () => {
      const dialog = await openDialog();
      expect(within(dialog).getByText('Auto 100% · now 100%')).toBeInTheDocument();
    });

    it('applies the chosen size', async () => {
      const dialog = await openDialog();
      fireEvent.change(within(dialog).getByRole('slider', { name: 'Adjustment' }), { target: { value: '110' } });
      expect(useApp.getState().uiSize).toBe(110);
      expect(within(dialog).getByText('Auto 100% · now 110%')).toBeInTheDocument();
    });

    it('steps by the mouse wheel within the bounds', async () => {
      const dialog = await openDialog();
      const slider = within(dialog).getByRole('slider', { name: 'Adjustment' });
      useApp.getState().setUiSize(50);
      fireEvent.wheel(slider, { deltaY: 100 });
      expect(useApp.getState().uiSize).toBe(50);
      useApp.getState().setUiSize(200);
      fireEvent.wheel(slider, { deltaY: -100 });
      expect(useApp.getState().uiSize).toBe(200);
      useApp.getState().setUiSize(125);
      fireEvent.wheel(slider, { deltaY: -100 });
      expect(useApp.getState().uiSize).toBe(130);
    });

    it('ignores a horizontal wheel swipe', async () => {
      const dialog = await openDialog();
      const slider = within(dialog).getByRole('slider', { name: 'Adjustment' });
      expect(fireEvent.wheel(slider, { deltaX: 40, deltaY: 0 })).toBe(true);
      expect(useApp.getState().uiSize).toBe(100);
    });

    it('resets to 100', async () => {
      const dialog = await openDialog();
      const reset = within(dialog).getByRole('button', { name: 'Reset' });
      expect(reset).toBeDisabled();
      useApp.getState().setUiSize(90);
      await userEvent.click(reset);
      expect(useApp.getState().uiSize).toBe(100);
    });
  });
});
