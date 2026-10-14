import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { ViewLens } from './ViewLens';

vi.mock('../../api/client', () => ({ api: {} }));

beforeEach(() => {
  useApp.setState({ ...initialState(), filterOptions: vi.fn(async () => []) });
});

describe('ViewLens', () => {
  it('shows the Overview as friendlies only and offers the own side on a filter tab', () => {
    useApp.setState({ tab: 'overview', filters: { ...initialState().filters, perspective: 'enemy' } });
    const { rerender } = render(<ViewLens />);
    expect(screen.getByRole('button', { name: 'Friendlies' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Enemies' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /All enemies/ })).toBeNull();
    useApp.setState({ tab: 'taken' });
    rerender(<ViewLens />);
    expect(screen.getByRole('button', { name: 'Enemies' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Taken by.*All enemies/ })).toBeEnabled();
  });
});
