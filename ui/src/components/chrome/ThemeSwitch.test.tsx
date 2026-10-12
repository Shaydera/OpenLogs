import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { api } from '../../api/client';
import { initialState, useApp } from '../../store';
import { gameDataFixture } from '../../test/gameDataFixture';

vi.mock('../../api/client', () => ({
  api: { recentLogs: vi.fn(), openLog: vi.fn(), gameDataStatus: vi.fn(), refreshGameData: vi.fn() },
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: vi.fn().mockResolvedValue(() => {}) }),
}));

const root = document.documentElement;
let osDark = true;
const listeners = new Set<() => void>();

beforeEach(() => {
  vi.mocked(api.recentLogs).mockReset().mockResolvedValue([]);
  vi.mocked(api.gameDataStatus).mockReset().mockResolvedValue(gameDataFixture);
  localStorage.clear();
  osDark = true;
  listeners.clear();
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return osDark;
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
  useApp.setState(initialState());
});
afterEach(() => vi.unstubAllGlobals());

const modeGroup = () => screen.getByRole('banner').querySelector<HTMLElement>('.theme-switch')!;

describe('theme switch', () => {
  it('follows the OS while System is chosen and stops when the user picks a mode', async () => {
    osDark = false;
    render(<App />);
    await userEvent.click(within(modeGroup()).getByRole('button', { name: 'System' }));
    expect(root.dataset.mode).toBe('light');
    osDark = true;
    listeners.forEach((listener) => listener());
    expect(root.dataset.mode).toBe('dark');
    await userEvent.click(within(modeGroup()).getByRole('button', { name: 'Light' }));
    expect(listeners.size).toBe(0);
    expect(root.dataset.mode).toBe('light');
  });
});
