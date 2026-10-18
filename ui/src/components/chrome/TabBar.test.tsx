import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { TabBar } from './TabBar';

vi.mock('../../api/client', () => ({ api: {} }));

beforeEach(() => {
  localStorage.clear();
  useApp.setState(initialState());
});

describe('tab bar', () => {
  it('puts the Replay tab last, with its icon', () => {
    render(<TabBar />);
    const replay = screen.getAllByRole('tab').at(-1);
    expect(replay).toHaveAccessibleName('Replay');
    expect(replay?.querySelector('svg')).not.toBeNull();
  });
});
