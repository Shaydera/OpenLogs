import { openUrl } from '@tauri-apps/plugin-opener';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RELEASES_URL } from '../../build';
import { useUpdateCheck } from '../../hooks/useUpdateCheck';
import { initialState, useApp } from '../../store';
import { UPDATE_CHECK_MS } from '../../updateCheck';
import { UpdateNotice } from './UpdateNotice';

const build = vi.hoisted(() => ({ IN_DESKTOP_APP: true }));
vi.mock('../../build', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../build')>()),
  get IN_DESKTOP_APP() {
    return build.IN_DESKTOP_APP;
  },
  APP_VERSION: '0.1.0-beta8',
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

const fetchMock = vi.fn<typeof fetch>();
const releases = (...tags: string[]) =>
  new Response(JSON.stringify(tags.map((tag) => ({ tag_name: tag, html_url: `${RELEASES_URL}tag/${tag}`, draft: false }))));

function Shell() {
  useUpdateCheck();
  return <UpdateNotice />;
}

async function settle() {
  await act(() => vi.advanceTimersByTimeAsync(0));
}

beforeEach(() => {
  build.IN_DESKTOP_APP = true;
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  vi.mocked(openUrl).mockReset().mockResolvedValue();
  localStorage.clear();
  useApp.setState(initialState());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('UpdateNotice', () => {
  it('checks at start and every 30 minutes, and stops when turned off', async () => {
    fetchMock.mockResolvedValueOnce(releases('v0.1.0-beta8')).mockResolvedValueOnce(releases('v0.1.0-beta9', 'v0.1.0-beta8'));
    render(<Shell />);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    await act(() => vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('OpenLogs 0.1.0-beta9 is available');

    act(() => useApp.getState().setUpdateCheck(false));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    await act(() => vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never asks GitHub outside the desktop app', async () => {
    build.IN_DESKTOP_APP = false;
    render(<Shell />);
    await act(() => vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks once while a check is still on its way', async () => {
    fetchMock.mockImplementation(async () => releases('v0.1.0-beta9'));
    await Promise.all([useApp.getState().checkForUpdate(), useApp.getState().checkForUpdate()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the last result when a check fails', async () => {
    fetchMock.mockResolvedValueOnce(releases('v0.1.0-beta9')).mockRejectedValueOnce(new TypeError('offline'));
    render(<Shell />);
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS));
    expect(screen.getByRole('status')).toHaveTextContent('OpenLogs 0.1.0-beta9 is available');
  });

  it('opens the release page in the browser', async () => {
    fetchMock.mockImplementation(async () => releases('v0.1.0-beta9'));
    render(<Shell />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'View release' }));
    await vi.waitFor(() => expect(openUrl).toHaveBeenCalledWith(`${RELEASES_URL}tag/v0.1.0-beta9`));
  });

  it('stays closed for that version after a restart, but not for a newer one', async () => {
    fetchMock.mockImplementation(async () => releases('v0.1.0-beta9'));
    const { unmount } = render(<Shell />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    unmount();

    useApp.setState(initialState());
    render(<Shell />);
    await settle();
    expect(useApp.getState().availableUpdate?.version).toBe('0.1.0-beta9');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    fetchMock.mockImplementation(async () => releases('v0.1.0-beta10'));
    await act(() => vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS));
    expect(screen.getByRole('status')).toHaveTextContent('OpenLogs 0.1.0-beta10 is available');
  });
});
