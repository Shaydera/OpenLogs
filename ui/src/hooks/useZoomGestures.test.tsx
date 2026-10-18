import { act, createEvent, fireEvent, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { initialState, useApp } from '../store';
import { useZoomGestures } from './useZoomGestures';

beforeEach(() => {
  localStorage.clear();
  useApp.setState(initialState());
});

const size = () => useApp.getState().uiSize;

function mount() {
  return renderHook(() => useZoomGestures());
}

describe('useZoomGestures', () => {
  it('zooms in on Ctrl+wheel up and out on wheel down, stopping the browser zoom', () => {
    mount();
    expect(fireEvent.wheel(window, { ctrlKey: true, deltaY: -100 })).toBe(false);
    expect(size()).toBe(110);
    fireEvent.wheel(window, { ctrlKey: true, deltaY: 100 });
    fireEvent.wheel(window, { ctrlKey: true, deltaY: 100 });
    expect(size()).toBe(90);
  });

  it('accumulates small pinch deltas into one step', () => {
    mount();
    for (let i = 0; i < 4; i++) fireEvent.wheel(window, { ctrlKey: true, deltaY: -20 });
    expect(size()).toBe(100);
    fireEvent.wheel(window, { ctrlKey: true, deltaY: -20 });
    expect(size()).toBe(110);
    fireEvent.wheel(window, { ctrlKey: true, deltaY: -20 });
    expect(size()).toBe(110);
  });

  it('drops a partial sum when the direction flips or the wheel rests', () => {
    mount();
    const wheel = (deltaY: number, timeStamp: number) => {
      const event = createEvent.wheel(window, { ctrlKey: true, deltaY });
      Object.defineProperty(event, 'timeStamp', { value: timeStamp });
      fireEvent(window, event);
    };
    wheel(-60, 1_000);
    wheel(60, 1_050);
    expect(size()).toBe(100);
    wheel(-60, 1_100);
    wheel(-60, 1_500);
    expect(size()).toBe(100);
    wheel(-60, 1_550);
    expect(size()).toBe(110);
  });

  it('counts a wheel turn in lines', () => {
    mount();
    fireEvent.wheel(window, { ctrlKey: true, deltaY: -7, deltaMode: 1 });
    expect(size()).toBe(110);
  });

  it('ignores a wheel without Ctrl or without vertical movement', () => {
    mount();
    expect(fireEvent.wheel(window, { deltaY: -100 })).toBe(true);
    expect(fireEvent.wheel(window, { ctrlKey: true, deltaY: 0 })).toBe(true);
    expect(size()).toBe(100);
  });

  it('leaves a gesture another component already handled', () => {
    mount();
    const target = document.createElement('div');
    document.body.append(target);
    target.addEventListener('wheel', (e) => e.preventDefault());
    fireEvent.wheel(target, { ctrlKey: true, deltaY: -100 });
    expect(size()).toBe(100);
    target.addEventListener('keydown', (e) => e.preventDefault());
    fireEvent.keyDown(target, { key: '+', ctrlKey: true });
    expect(size()).toBe(100);
    target.remove();
  });

  it.each([
    ['+', 110],
    ['=', 110],
    ['Add', 110],
    ['-', 90],
    ['Subtract', 90],
  ])('Ctrl+%s moves the size', (key, expected) => {
    mount();
    expect(fireEvent.keyDown(window, { key, ctrlKey: true })).toBe(false);
    expect(size()).toBe(expected);
  });

  it('Ctrl+0 resets to 100, also with the meta key', () => {
    mount();
    act(() => useApp.getState().setUiSize(150));
    fireEvent.keyDown(window, { key: '0', metaKey: true });
    expect(size()).toBe(100);
  });

  it('works inside a text field', () => {
    mount();
    const input = document.createElement('input');
    document.body.append(input);
    fireEvent.keyDown(input, { key: '+', ctrlKey: true });
    expect(size()).toBe(110);
    input.remove();
  });

  it('ignores the keys without Ctrl', () => {
    mount();
    expect(fireEvent.keyDown(window, { key: '+' })).toBe(true);
    expect(size()).toBe(100);
  });

  it('clamps at 50 and 200 but still stops the browser zoom', () => {
    mount();
    act(() => useApp.getState().setUiSize(200));
    expect(fireEvent.keyDown(window, { key: '+', ctrlKey: true })).toBe(false);
    expect(size()).toBe(200);
    act(() => useApp.getState().setUiSize(50));
    expect(fireEvent.keyDown(window, { key: '-', ctrlKey: true })).toBe(false);
    expect(size()).toBe(50);
    act(() => useApp.getState().setUiSize(55));
    fireEvent.keyDown(window, { key: '-', ctrlKey: true });
    expect(size()).toBe(50);
  });

  it('stops listening on unmount', () => {
    mount().unmount();
    fireEvent.keyDown(window, { key: '+', ctrlKey: true });
    expect(size()).toBe(100);
  });
});
