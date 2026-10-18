import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { MeterData, MeterEntry, MeterRow } from '../../api/types';
import { formatAmount, formatShare } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { initialState, useApp } from '../../store';
import { compareLogFixture } from '../../test/compareFixture';
import { replayFixture } from '../../test/replayFixture';
import { indexHud } from './hudIndex';
import { Meter } from './Meter';
import { meterSpan } from './useMeter';

vi.mock('../../api/client', () => ({ api: { replayMeter: vi.fn() } }));

const meter = vi.mocked(api.replayMeter);
const hud = indexHud(replayFixture);
const BOUNDS = { startMs: 0, endMs: 300_000 };

const meterData = (rows: MeterRow[], breakdown: MeterEntry[] = [], spells: MeterData['spells'] = {}): MeterData => ({ durationMs: 60_000, rows, breakdown, spells, units: {} });

function deferred() {
  let resolve: (data: MeterData) => void = () => {};
  const promise = new Promise<MeterData>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const playerRows = () => within(screen.getByRole('list', { name: t('replay.players') })).getAllByRole('button');

beforeEach(() => {
  meter.mockReset();
  meter.mockResolvedValue(meterData([]));
  useApp.setState({ ...initialState(), log: compareLogFixture, view: { kind: 'fight', fightIndex: 3 }, replayData: replayFixture, replay: { ...initialState().replay, time: 60_000 } });
});

describe('meterSpan', () => {
  it('clips the window at the range start', () => {
    const range = { startMs: 60_000, endMs: 120_000 };
    expect(meterSpan(range, 65_000, 'window', 10_000)).toEqual({ startMs: 60_000, endMs: 65_000 });
    expect(meterSpan(range, 100_000, 'window', 30_000)).toEqual({ startMs: 70_000, endMs: 100_000 });
    expect(meterSpan(range, 100_000, 'cumulative', 30_000)).toEqual({ startMs: 60_000, endMs: 100_000 });
  });
});

describe('Meter', () => {
  it('lists players by amount with per-second values', async () => {
    meter.mockResolvedValue(
      meterData([
        { player: 2, amount: 1_200_000, perSecond: 20_000 },
        { player: 1, amount: 600_000, perSecond: 10_000 },
      ]),
    );
    render(<Meter hud={hud} bounds={BOUNDS} />);
    await screen.findByRole('button', { name: /Miravel/ });
    const [first, second] = playerRows();
    expect(first).toHaveTextContent('Miravel');
    expect(first).toHaveTextContent(formatAmount(1_200_000));
    expect(first).toHaveTextContent(t('replay.perSecond', { value: formatAmount(20_000) }));
    expect(second).toHaveTextContent('Talwyn');
  });

  it('clicking a row selects the player and shows their breakdown', async () => {
    meter.mockImplementation(async (_log, _fight, _filter, _category, expand) =>
      meterData(
        [
          { player: 1, amount: 1_500_000, perSecond: 25_000 },
          { player: 2, amount: 1_200_000, perSecond: 20_000 },
        ],
        expand === 2
          ? [
              { kind: 'ability', spellId: 7001, actorId: 2, rowKind: 'own', amount: 900_000 },
              { kind: 'ability', spellId: 7002, actorId: 2, rowKind: 'own', amount: 300_000 },
            ]
          : [],
        { '7001': { name: 'Dawnmend' }, '7002': { name: 'Quiet Prayer' } },
      ),
    );
    render(<Meter hud={hud} bounds={BOUNDS} />);
    const row = await screen.findByRole('button', { name: /Miravel/ });
    await userEvent.click(row);
    expect(useApp.getState().replay.selected).toBe(2);
    const breakdown = await screen.findByRole('list', { name: t('replay.meterBreakdown', { name: 'Miravel' }) });
    const [top] = within(breakdown).getAllByRole('listitem');
    expect(top).toHaveTextContent('Dawnmend');
    expect(top).toHaveTextContent(formatShare(75));

    await userEvent.click(row);
    expect(screen.queryByRole('list', { name: t('replay.meterBreakdown', { name: 'Miravel' }) })).toBeNull();
    expect(useApp.getState().replay.selected).toBe(2);
  });

  it('caps the breakdown at six entries until the rest is asked for', async () => {
    const spells = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [String(7001 + i), { name: `Rite ${i + 1}` }]));
    const breakdown: MeterEntry[] = Array.from({ length: 8 }, (_, i) => ({ kind: 'ability', spellId: 7001 + i, actorId: 2, rowKind: 'own', amount: 80_000 - i * 1_000 }));
    meter.mockImplementation(async (_log, _fight, _filter, _category, expand) => meterData([{ player: 2, amount: 1_200_000, perSecond: 20_000 }], expand === 2 ? breakdown : [], spells));
    useApp.setState({ replay: { ...useApp.getState().replay, selected: 2 } });
    render(<Meter hud={hud} bounds={BOUNDS} />);
    const list = await screen.findByRole('list', { name: t('replay.meterBreakdown', { name: 'Miravel' }) });
    expect(within(list).getAllByRole('listitem')).toHaveLength(7);
    expect(within(list).queryByText('Rite 7')).toBeNull();

    await userEvent.click(within(list).getByRole('button', { name: t('replay.meterMore', { count: 2 }) }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(8);
    expect(within(list).getByText('Rite 8')).toBeInTheDocument();
  });

  it('a collapsed meter asks nothing until it is expanded', async () => {
    render(<Meter hud={hud} bounds={BOUNDS} defaultCollapsed />);
    await act(async () => {});
    act(() => useApp.getState().setReplayTime(90_000));
    await act(async () => {});
    expect(meter).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: t('replay.meter') }));
    await waitFor(() => expect(meter).toHaveBeenCalledTimes(1));
    expect(meter.mock.calls[0][2]).toMatchObject({ endMs: 90_000 });
  });

  it('asks for the chosen category and window', async () => {
    render(<Meter hud={hud} bounds={BOUNDS} />);
    await waitFor(() => expect(meter).toHaveBeenCalled());
    await userEvent.selectOptions(screen.getByRole('combobox', { name: t('replay.meterCategory') }), t('replay.meterHealingDone'));
    await waitFor(() => expect(meter).toHaveBeenLastCalledWith(compareLogFixture.id, 3, { startMs: 0, endMs: 60_000, attribution: 'reattributed' }, 'healingDone', null));

    await userEvent.click(screen.getByRole('button', { name: t('replay.meterWindow') }));
    await userEvent.click(screen.getByRole('button', { name: t('replay.meterSeconds', { value: 30 }) }));
    await waitFor(() => expect(meter).toHaveBeenLastCalledWith(compareLogFixture.id, 3, { startMs: 30_000, endMs: 60_000, attribution: 'reattributed' }, 'healingDone', null));
  });

  it('drops an answer for an older request', async () => {
    const older = deferred();
    const newer = deferred();
    meter.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    render(<Meter hud={hud} bounds={BOUNDS} />);
    await waitFor(() => expect(meter).toHaveBeenCalledTimes(1));
    act(() => useApp.getState().setReplayTime(90_000));

    await act(async () => older.resolve(meterData([{ player: 3, amount: 50_000, perSecond: 1_000 }])));
    await waitFor(() => expect(meter).toHaveBeenCalledTimes(2));
    expect(meter.mock.calls[1][2]).toMatchObject({ endMs: 90_000 });
    expect(screen.queryByRole('button', { name: /Orsek/ })).toBeNull();

    await act(async () => newer.resolve(meterData([{ player: 2, amount: 90_000, perSecond: 1_000 }])));
    expect(await screen.findByRole('button', { name: /Miravel/ })).toBeInTheDocument();
  });

  it('keeps answers that arrive while playing and asks again 250 ms after the last query', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      const first = deferred();
      meter.mockReturnValueOnce(first.promise);
      useApp.setState({ replay: { ...useApp.getState().replay, playing: true } });
      render(<Meter hud={hud} bounds={BOUNDS} />);
      await act(async () => {});
      expect(meter).toHaveBeenCalledTimes(1);

      act(() => useApp.setState({ replay: { ...useApp.getState().replay, time: 60_100 } }));
      await act(async () => first.resolve(meterData([{ player: 2, amount: 90_000, perSecond: 1_500 }])));
      expect(screen.getByRole('button', { name: /Miravel/ })).toBeInTheDocument();
      expect(meter).toHaveBeenCalledTimes(1);

      await act(async () => vi.advanceTimersByTime(250));
      expect(meter).toHaveBeenCalledTimes(2);
      expect(meter.mock.calls[1][2]).toMatchObject({ endMs: 60_100 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-queries when the attribution changes', async () => {
    render(<Meter hud={hud} bounds={BOUNDS} />);
    await waitFor(() => expect(meter).toHaveBeenCalledTimes(1));
    act(() => useApp.setState({ attribution: 'augmented' }));
    await waitFor(() => expect(meter).toHaveBeenCalledTimes(2));
    expect(meter.mock.calls[1][2]).toMatchObject({ attribution: 'augmented' });
  });

  it('shows the empty hint at the start of the range', async () => {
    meter.mockResolvedValue(meterData([{ player: 2, amount: 90_000, perSecond: 1_000 }]));
    useApp.setState({ range: { startMs: 60_000, endMs: 120_000 } });
    render(<Meter hud={hud} bounds={{ startMs: 60_000, endMs: 120_000 }} />);
    expect(await screen.findByText(t('replay.meterEmpty'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Miravel/ })).toBeNull();
  });
});
