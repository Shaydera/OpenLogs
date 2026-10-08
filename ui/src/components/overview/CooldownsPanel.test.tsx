import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { overviewFixture } from '../../test/overviewFixture';
import { CooldownsPanel } from './CooldownsPanel';

describe('CooldownsPanel', () => {
  it('groups players by role and filters their casts by category', async () => {
    render(<CooldownsPanel overview={overviewFixture} />);
    expect(screen.getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['Cooldown category', 'Tanks', 'Healers', 'DPS']);
    expect(within(screen.getByRole('group', { name: 'DPS' })).getByText('Faelan')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Tranquility · 2:30' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Offensive' }));
    expect(screen.queryByRole('img', { name: 'Tranquility · 2:30' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Time Warp · 0:02' })).toBeInTheDocument();
  });
});
