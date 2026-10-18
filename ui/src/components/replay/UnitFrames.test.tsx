import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuraCategory, ReplayAura, ReplayData } from '../../api/types';
import { formatAmount } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { initialState, useApp } from '../../store';
import { replayFixture } from '../../test/replayFixture';
import { powerName } from '../resources/powerNames';
import { indexHud } from './hudIndex';
import { UnitFrames } from './UnitFrames';

vi.mock('../../api/client', () => ({ api: {} }));

const MANA = 0;

const debuff = (target: number, spellId: number, category: AuraCategory, source: number, sourcePlayer: number | null): ReplayAura => ({
  target,
  source,
  spellId,
  buff: false,
  startMs: 0,
  endMs: 100_000,
  stacks: [],
  raidFrame: null,
  category,
  sourcePlayer,
});

const spells = { 501: { name: 'Hollow Brand' }, 502: { name: 'Petbite' }, 503: { name: 'Rend' }, 504: { name: 'Mire' } };

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

  describe('aura filter', () => {
    const auras = [debuff(10, 501, 'encounter', 10, null), debuff(10, 502, 'other', 4, 3), debuff(10, 503, 'other', 2, 2)];
    const debuffsIn = (frame: HTMLElement) => within(frame).queryAllByRole('img').map((icon) => icon.getAttribute('aria-label'));
    const targetFrame = () => screen.getByRole('group', { name: t('replay.targetFrame') });

    it("shows the selected player's pet debuff on the target", () => {
      show({ auras, spells, targets: [{ actor: 4, t: [0], target: [10] }] }, 4);
      expect(debuffsIn(targetFrame())).toEqual(['Hollow Brand', 'Petbite']);
    });

    it('a selected boss shows only important debuffs', () => {
      show({ auras: [...auras, debuff(10, 504, 'other', 10, null)], spells, targets: [{ actor: 10, t: [0], target: [11] }] }, 10);
      expect(debuffsIn(screen.getByRole('group', { name: 'Gorvath the Hollow' }))).toEqual(['Hollow Brand']);
    });

    it('all auras shows everything', async () => {
      show({ auras, spells });
      expect(debuffsIn(targetFrame())).toEqual(['Hollow Brand']);
      await userEvent.click(screen.getByRole('button', { name: t('replay.allAuras') }));
      expect(debuffsIn(targetFrame())).toEqual(['Hollow Brand', 'Petbite', 'Rend']);
      expect(screen.getByRole('button', { name: t('replay.allAuras') })).toHaveAttribute('aria-pressed', 'true');
    });
  });
});
