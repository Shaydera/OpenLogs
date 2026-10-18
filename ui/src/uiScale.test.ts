import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyUiScale, autoScale, currentAutoScale, effectiveScale, readUiSize } from './uiScale';

function stubZoomSupport() {
  Object.defineProperty(Element.prototype, 'currentCSSZoom', { value: 1, configurable: true });
}

afterEach(() => {
  delete (Element.prototype as { currentCSSZoom?: number }).currentCSSZoom;
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('autoScale', () => {
  it.each([
    [1920, 1000, 0.8],
    [2560, 1360, 1.08],
    [3072, 1650, 1.28],
    [3440, 1360, 1.08],
    [1366, 720, 0.8],
    [960, 640, 0.8],
  ])('%i x %i gives %f', (width, height, expected) => {
    expect(autoScale(width, height)).toBe(expected);
  });
});

describe('effectiveScale', () => {
  it('multiplies the automatic factor by the adjustment', () => {
    expect(effectiveScale(1.6, 90)).toBe(1.44);
    expect(effectiveScale(1, 80)).toBe(0.8);
  });
});

describe('readUiSize', () => {
  it.each(['abc', '45', '205', '52', null])('falls back to 100 for %s', (stored) => {
    if (stored !== null) localStorage.setItem('openlogs.uiSize', stored);
    expect(readUiSize()).toBe(100);
  });

  it.each(['50', '200'])('keeps the bound %s', (stored) => {
    localStorage.setItem('openlogs.uiSize', stored);
    expect(readUiSize()).toBe(Number(stored));
  });

  it('reads a valid stored size', () => {
    localStorage.setItem('openlogs.uiSize', '115');
    expect(readUiSize()).toBe(115);
  });
});

describe('applyUiScale', () => {
  it('writes the scale to the root when zoom is supported', () => {
    stubZoomSupport();
    const el = document.createElement('div');
    applyUiScale(1.6, el);
    expect(el.style.getPropertyValue('--ui-scale')).toBe('1.6');
  });

  it('keeps the layout unscaled without zoom support', () => {
    const el = document.createElement('div');
    applyUiScale(1.6, el);
    expect(el.style.getPropertyValue('--ui-scale')).toBe('1');
  });
});

describe('currentAutoScale', () => {
  it('stays at the base scale without zoom support', () => {
    vi.stubGlobal('innerWidth', 3072);
    vi.stubGlobal('innerHeight', 1650);
    expect(currentAutoScale()).toBe(0.8);
  });

  it('follows the window size with zoom support', () => {
    stubZoomSupport();
    vi.stubGlobal('innerWidth', 3072);
    vi.stubGlobal('innerHeight', 1650);
    expect(currentAutoScale()).toBe(1.28);
  });
});
