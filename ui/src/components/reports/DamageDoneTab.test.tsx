import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { breakdownFixture, damageReportFixture } from '../../test/reportFixtures';
import { DamageDoneTab } from './DamageDoneTab';

vi.mock('../../api/client', () => ({ api: {} }));

beforeEach(() => {
  localStorage.clear();
  useApp.setState({ ...initialState(), tab: 'damage', attribution: 'reattributed', showAugDelta: true });
});

const rows = () => within(screen.getByRole('group', { name: 'Damage Done rows' }));

describe('DamageDoneTab', () => {
  it('shows the Aug extras of the selected player only in the unfiltered source view', async () => {
    const { rerender } = render(<DamageDoneTab report={damageReportFixture} breakdown={breakdownFixture} />);
    await userEvent.click(rows().getByRole('button', { name: /Speronis/ }));
    expect(within(screen.getByRole('complementary')).getByText('Support by recipient')).toBeInTheDocument();
    expect(rows().getByRole('button', { name: /Speronis/ })).toHaveTextContent('+87.29M');

    useApp.setState({ filters: { ...initialState().filters, other: [{ kind: 'unit', name: "Ula'tek" }] } });
    rerender(<DamageDoneTab report={damageReportFixture} breakdown={breakdownFixture} />);
    expect(within(screen.getByRole('complementary')).queryByText('Support by recipient')).toBeNull();
    expect(rows().getByRole('button', { name: /Speronis/ })).not.toHaveTextContent('+87.29M');
  });

  it('shows hits and their average only once a single source is filtered', () => {
    const { rerender } = render(<DamageDoneTab report={damageReportFixture} breakdown={breakdownFixture} />);
    expect(screen.queryByText('Hits')).toBeNull();
    expect(screen.queryByText('Avg Hit')).toBeNull();

    useApp.setState({ filters: { ...initialState().filters, own: [{ kind: 'player', actorId: 3 }] } });
    rerender(<DamageDoneTab report={damageReportFixture} breakdown={breakdownFixture} />);
    expect(screen.getByText('Hits')).toBeInTheDocument();
    expect(screen.getByText('Avg Hit')).toBeInTheDocument();
  });
});
