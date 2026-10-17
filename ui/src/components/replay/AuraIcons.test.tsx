import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ReplayAura, ReplayData } from '../../api/types';
import { formatSpan } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { replayFixture } from '../../test/replayFixture';
import { AuraIcons } from './AuraIcons';
import { indexHud } from './hudIndex';

const aura = (spellId: number, endMs: number, stacks: number): ReplayAura => ({
  target: 1,
  source: 2,
  spellId,
  buff: true,
  startMs: 40_000,
  endMs,
  stacks: [{ t: 40_000, stacks }],
  raidFrame: null,
});

describe('AuraIcons', () => {
  it('shows the remaining time, stacks from two up, and no countdown for an aura that lasts to the pull end', () => {
    const data: ReplayData = { ...replayFixture, spells: { '7000': { name: 'Ember Ward' }, '7001': { name: 'Quiet Mind' }, '7002': { name: 'Long Vigil' } } };
    const auras = [aura(7000, 62_000, 3), aura(7001, 52_500, 1), aura(7002, data.durationMs, 2)];
    render(<AuraIcons hud={indexHud(data)} auras={auras} time={50_000} label={t('replay.buffs')} size={18} />);

    const stacked = screen.getByRole('img', { name: 'Ember Ward' });
    expect(within(stacked).getByText('12')).toBeInTheDocument();
    expect(within(stacked).getByText('3')).toBeInTheDocument();
    expect(stacked).toHaveAttribute('aria-description', `${t('replay.auraLeft', { time: formatSpan(12_000) })}${t('replay.separator')}${t('replay.auraStacks', { count: 3 })}`);

    const single = screen.getByRole('img', { name: 'Quiet Mind' });
    expect(single).toHaveTextContent(/^3$/);
    expect(single).toHaveAttribute('aria-description', t('replay.auraLeft', { time: formatSpan(2_500) }));

    const untilEnd = screen.getByRole('img', { name: 'Long Vigil' });
    expect(untilEnd).toHaveTextContent(/^2$/);
    expect(untilEnd).toHaveAttribute('aria-description', t('replay.auraStacks', { count: 2 }));
  });
});
