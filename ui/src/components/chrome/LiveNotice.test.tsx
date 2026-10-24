import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { LiveNotice } from './LiveNotice';

beforeEach(() => {
  vi.useFakeTimers();
  useApp.setState(initialState());
});
afterEach(() => vi.useRealTimers());

describe('LiveNotice', () => {
  it('announces the new pull and goes away by itself', () => {
    useApp.setState({ liveNotice: { kind: 'pull', n: 33, status: 'wipe', bossHpPercent: 12.4 } });
    render(<LiveNotice />);
    expect(screen.getByRole('status')).toHaveTextContent('Pull 33 loaded · Wipe 12.40%');
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
