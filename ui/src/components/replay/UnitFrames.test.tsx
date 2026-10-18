import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplayData } from '../../api/types';
import { formatAmount } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { initialState, useApp } from '../../store';
import { replayFixture } from '../../test/replayFixture';
import { powerName } from '../resources/powerNames';
import { indexHud } from './hudIndex';
import { UnitFrames } from './UnitFrames';

vi.mock('../../api/client', () => ({ api: {} }));

const MANA = 0;

const data: ReplayData = {
  ...replayFixture,
  health: [
    { actor: 1, t: [0], current: [80_000], max: [100_000] },
    { actor: 10, t: [0], current: [5_000_000], max: [8_000_000] },
    { actor: 2, t: [0], current: [60_000], max: [90_000] },
  ],
  power: [{ actor: 1, powerType: MANA, t: [0], current: [45_000], max: [60_000] }],
  targets: [
    { actor: 1, t: [0], target: [10] },
    { actor: 10, t: [0], target: [2] },
  ],
};

function show(overrides: Partial<ReplayData> = {}, selected: number | null = 1, time = 10_000) {
  useApp.setState({ replay: { ...initialState().replay, selected, time } });
  return render(<UnitFrames hud={indexHud({ ...data, ...overrides })} />);
}

beforeEach(() => {
  useApp.setState(initialState());
});

describe('UnitFrames', () => {
  it("shows the selected player's health and mana as values", () => {
    show();
    const player = screen.getByRole('group', { name: 'Talwyn' });
    expect(within(player).getByText(t('replay.valueOfMax', { current: formatAmount(80_000), max: formatAmount(100_000) }))).toBeInTheDocument();
    const mana = within(player).getByRole('meter', { name: powerName(MANA) });
    expect(mana).toHaveAttribute('aria-valuetext', t('replay.valueOfMax', { current: formatAmount(45_000), max: formatAmount(60_000) }));
  });

  it('shows the target and its target from the target tracks', () => {
    show();
    const target = screen.getByRole('group', { name: t('replay.targetFrame') });
    expect(within(target).getByRole('button', { name: /Gorvath the Hollow/ })).toBeInTheDocument();
    const targetsTarget = screen.getByRole('group', { name: t('replay.targetOfTarget') });
    expect(within(targetsTarget).getByRole('button', { name: /Miravel/ })).toBeInTheDocument();
  });

  it('clicking the target frame selects it', async () => {
    show();
    await userEvent.click(within(screen.getByRole('group', { name: t('replay.targetFrame') })).getByRole('button', { name: /Gorvath the Hollow/ }));
    expect(useApp.getState().replay.selected).toBe(10);
  });

  it('shows no power bar without power samples', () => {
    show({ power: [] });
    expect(within(screen.getByRole('group', { name: 'Talwyn' })).queryByRole('meter', { name: powerName(MANA) })).toBeNull();
  });

  it('a dead target shows dead', () => {
    show({ targets: [{ actor: 1, t: [0], target: [3] }] }, 1, 200_000);
    const target = screen.getByRole('group', { name: t('replay.targetFrame') });
    expect(within(target).getByText(new RegExp(t('replay.dead')))).toBeInTheDocument();
  });

  it('renders nothing without a selection', () => {
    show({}, null);
    expect(screen.queryByRole('region', { name: t('replay.unitFrames') })).toBeNull();
  });
});
