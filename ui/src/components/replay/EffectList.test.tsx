import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffectInstance, ReplayData } from '../../api/types';
import { t } from '../../i18n/i18n';
import { initialState, useApp } from '../../store';
import { replayFixture } from '../../test/replayFixture';
import { EffectList } from './EffectList';
import { indexHud } from './hudIndex';

vi.mock('../../api/client', () => ({ api: {} }));

const hymn = (startMs: number): EffectInstance => ({
  name: 'Verdant Hymn',
  spellId: 7001,
  caster: 2,
  anchor: { type: 'ground', x: 100, y: 200 },
  radiusYd: 40,
  startMs,
  endMs: startMs + 5_000,
  estimated: false,
  kind: 'beneficial',
  category: 'heal',
  affected: [],
});

const at = (time: number) => act(() => useApp.setState({ replay: { ...useApp.getState().replay, time } }));

beforeEach(() => {
  useApp.setState(initialState());
});

describe('EffectList', () => {
  it('a collapsed list stays collapsed across a gap without effects', async () => {
    const data: ReplayData = { ...replayFixture, effects: [hymn(10_000), hymn(30_000)] };
    at(12_000);
    render(<EffectList hud={indexHud(data)} selected={null} onSelect={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: t('replay.activeEffects') }));
    expect(screen.queryByRole('button', { name: /Verdant Hymn/ })).toBeNull();

    at(20_000);
    expect(screen.queryByRole('button', { name: t('replay.activeEffects') })).toBeNull();
    at(32_000);
    expect(screen.getByRole('button', { name: t('replay.activeEffects') })).toHaveAttribute('aria-expanded', 'false');
  });
});
