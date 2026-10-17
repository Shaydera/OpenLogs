import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplayData, ReplayUnit } from '../../api/types';
import { formatSeconds } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { initialState, useApp } from '../../store';
import { replayFixture } from '../../test/replayFixture';
import { BossFrames } from './BossFrames';
import { indexHud } from './hudIndex';

vi.mock('../../api/client', () => ({ api: {} }));

const at = (time: number) => useApp.setState({ replay: { ...initialState().replay, time } });

beforeEach(() => {
  useApp.setState(initialState());
});

describe('BossFrames', () => {
  it('shows the boss cast bar with the remaining time', () => {
    const data: ReplayData = {
      ...replayFixture,
      spells: { '4100': { name: 'Hollow Roar' } },
      casts: [{ caster: 10, spellId: 4100, target: null, startMs: 10_000, endMs: 13_000, outcome: 'completed' }],
    };
    at(11_300);
    const { rerender } = render(<BossFrames hud={indexHud(data)} />);
    const boss = screen.getByRole('group', { name: 'Gorvath the Hollow' });
    expect(within(boss).getByRole('progressbar', { name: 'Hollow Roar' })).toBeInTheDocument();
    expect(within(boss).getByText(formatSeconds(1_700))).toBeInTheDocument();

    at(13_500);
    rerender(<BossFrames hud={indexHud(data)} />);
    expect(within(boss).queryByRole('progressbar')).toBeNull();
  });

  it('shows an add cast bar with the remaining time only while the add casts', () => {
    const data: ReplayData = {
      ...replayFixture,
      spells: { '4200': { name: 'Ember Spit' } },
      health: [{ actor: 11, t: [0, 20_000], current: [800, 600], max: [800, 800] }],
      casts: [{ caster: 11, spellId: 4200, target: 1, startMs: 10_000, endMs: 12_000, outcome: 'completed' }],
    };
    at(10_500);
    const { rerender } = render(<BossFrames hud={indexHud(data)} />);
    const add = screen.getByRole('group', { name: 'Ashen Husk 1' });
    expect(within(add).getByRole('progressbar', { name: 'Ember Spit' })).toBeInTheDocument();
    expect(within(add).getByText(formatSeconds(1_500))).toBeInTheDocument();

    at(13_000);
    rerender(<BossFrames hud={indexHud(data)} />);
    expect(within(add).queryByRole('progressbar')).toBeNull();
    expect(within(add).queryByText(t('replay.noCast'))).toBeNull();
  });

  it('numbers adds per name and caps the list', () => {
    const clutches = Array.from({ length: 12 }, (_, i): ReplayUnit => ({ actor: 100 + i, name: 'Clutch', kind: 'add', specId: null, classId: null, owner: null, addNumber: i + 1 }));
    const data: ReplayData = {
      ...replayFixture,
      units: [...replayFixture.units, ...clutches],
      health: [
        { actor: 11, t: [0, 4_000], current: [800, 0], max: [800, 800] },
        ...clutches.map((add, i) => ({ actor: add.actor, t: [1_000 * (i + 1), 19_000], current: [500, 400], max: [1_000, 1_000] })),
      ],
      deaths: [...replayFixture.deaths, { actor: 11, t: 4_000, until: null }],
    };
    at(20_000);
    render(<BossFrames hud={indexHud(data)} />);
    const adds = screen.getAllByRole('group', { name: /^(Clutch|Ashen Husk)/ }).map((frame) => frame.getAttribute('aria-label'));
    expect(adds).toEqual(Array.from({ length: 8 }, (_, i) => `Clutch ${i + 1}`));
    expect(screen.getByText(t('replay.moreAdds', { count: 4 }))).toBeInTheDocument();
  });

  it('leaves out an add that stopped logging, so the live ones keep their frames', () => {
    const clutches = Array.from({ length: 9 }, (_, i): ReplayUnit => ({ actor: 100 + i, name: 'Clutch', kind: 'add', specId: null, classId: null, owner: null, addNumber: i + 1 }));
    const data: ReplayData = {
      ...replayFixture,
      units: [...replayFixture.units.filter((unit) => unit.kind !== 'add'), ...clutches],
      health: clutches.map((add, i) => {
        const t = i === 0 ? [500] : [500, 19_000];
        return { actor: add.actor, t, current: t.map(() => 900), max: t.map(() => 1_000) };
      }),
    };
    at(20_000);
    render(<BossFrames hud={indexHud(data)} />);
    const adds = screen.getAllByRole('group', { name: /^Clutch/ }).map((frame) => frame.getAttribute('aria-label'));
    expect(adds).toEqual(Array.from({ length: 8 }, (_, i) => `Clutch ${i + 2}`));
    expect(screen.queryByText(t('replay.moreAdds', { count: 1 }))).toBeNull();
  });
});
