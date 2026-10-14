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
});
