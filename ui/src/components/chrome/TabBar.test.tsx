import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type FightTab, initialState, useApp } from '../../store';
import { TabBar } from './TabBar';

vi.mock('../../api/client', () => ({ api: {} }));

beforeEach(() => {
  localStorage.clear();
  useApp.setState(initialState());
});

describe('tab bar', () => {
  it.each<[string, FightTab, boolean]>([
    ['the Aug toggle on the Overview', 'overview', true],
    ['no control on Damage Taken', 'taken', false],
  ])('shows %s', (_, tab, aug) => {
    useApp.setState({ tab });
    render(<TabBar />);
    expect(screen.queryByRole('group', { name: 'Aug damage' }) !== null).toBe(aug);
  });
});
