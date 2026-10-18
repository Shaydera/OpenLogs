import { readStored, writeStored } from './storage';

export const BASE_WIDTH = 1920;
export const BASE_HEIGHT = 1000;
export const UI_SIZES: readonly number[] = Array.from({ length: 11 }, (_, i) => 80 + i * 5);
const DEFAULT_UI_SIZE = 100;
const UI_SIZE_KEY = 'uiScale';

/** Grows with the window beyond the base size, in steps of 0.05; never shrinks below 1. */
export function autoScale(width: number, height: number): number {
  const fit = Math.min(width / BASE_WIDTH, height / BASE_HEIGHT);
  return Math.round(Math.max(1, fit) * 20) / 20;
}

export function effectiveScale(auto: number, sizePercent: number): number {
  return Math.round(auto * sizePercent) / 100;
}

export const zoomSupported = (): boolean => 'currentCSSZoom' in Element.prototype;

export const currentAutoScale = (): number => (zoomSupported() ? autoScale(window.innerWidth, window.innerHeight) : 1);

export function normalizeUiSize(percent: number): number {
  return UI_SIZES.includes(percent) ? percent : DEFAULT_UI_SIZE;
}

export const readUiSize = (): number => normalizeUiSize(Number(readStored(UI_SIZE_KEY)));
export const storeUiSize = (percent: number) => writeStored(UI_SIZE_KEY, String(percent));

/** Sets `--ui-scale` on the document root; without standardized zoom the layout stays at 1. */
export function applyUiScale(scale: number, root: HTMLElement = document.documentElement) {
  root.style.setProperty('--ui-scale', String(zoomSupported() ? scale : 1));
}
