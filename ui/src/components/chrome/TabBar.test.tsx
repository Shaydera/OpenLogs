import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Detail } from '../../api/types';
import { type FightTab, initialState, useApp } from '../../store';
import { TabBar } from './TabBar';

vi.mock('../../api/client', () => ({ api: {} }));

const ABILITY_PAGE: Detail[] = [
  { kind: 'player', player: 4 },
  { kind: 'ability', player: 4, spellId: 44425, pet: null },
];

beforeEach(() => {
  localStorage.clear();
  useApp.setState(initialState());
});

describe('tab bar', () => {
  it.each<[string, FightTab, Detail[], boolean]>([
    ['the Aug toggle on the Overview', 'overview', [], true],
    ['no control on an ability page', 'damage', ABILITY_PAGE, false],
  ])('shows %s', (_, tab, details, aug) => {
    useApp.setState({ tab, details });
    render(<TabBar />);
    expect(screen.queryByRole('group', { name: 'Aug damage' }) !== null).toBe(aug);
  });
});
