import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  category: 'other',
  sourcePlayer: null,
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

  it('shows the name, source and time left while an icon is hovered', async () => {
    const user = userEvent.setup();
    const data: ReplayData = { ...replayFixture, spells: { '7000': { name: 'Venom Bite' } } };
    const bite: ReplayAura = { ...aura(7000, 62_000, 3), target: 10, source: 4, buff: false, sourcePlayer: 3 };
    render(<AuraIcons hud={indexHud(data)} auras={[bite]} time={50_000} label={t('replay.debuffs')} size={18} />);

    await user.hover(screen.getByRole('img', { name: 'Venom Bite' }));
    const tip = screen.getByRole('tooltip');
    expect(within(tip).getByText('Venom Bite')).toBeInTheDocument();
    expect(within(tip).getByText(t('replay.auraDebuff'))).toBeInTheDocument();
    expect(within(tip).getByText('Orsek')).toBeInTheDocument();
    expect(within(tip).getByText(`${t('replay.auraLeft', { time: formatSpan(12_000) })}${t('replay.separator')}${formatSpan(22_000)}`)).toBeInTheDocument();
    expect(within(tip).getByText(t('replay.auraStacks', { count: 3 }))).toBeInTheDocument();

    await user.unhover(screen.getByRole('img', { name: 'Venom Bite' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('a tap opens the tooltip and a tap elsewhere closes it', async () => {
    const user = userEvent.setup();
    const data: ReplayData = { ...replayFixture, spells: { '7000': { name: 'Venom Bite' } } };
    render(<AuraIcons hud={indexHud(data)} auras={[aura(7000, 62_000, 1)]} time={50_000} label={t('replay.buffs')} size={18} />);

    await user.pointer({ keys: '[TouchA]', target: screen.getByRole('img', { name: 'Venom Bite' }) });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Venom Bite');

    await user.pointer({ keys: '[TouchA]', target: document.body });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
