import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Component tests run without game data: every icon shows its reference as the image source.
vi.mock('../icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../icons')>()),
  useIconSrc: (ref: string | null) => ref,
}));

afterEach(() => cleanup());

// jsdom has no canvas: the replay stage draws into a context whose drawing calls do nothing.
const canvasContext = new Proxy({} as Record<PropertyKey, unknown>, {
  get: (target, name) => (name === 'measureText' ? () => ({ width: 0 }) : name in target ? target[name] : () => {}),
});
HTMLCanvasElement.prototype.getContext = (() => canvasContext) as unknown as HTMLCanvasElement['getContext'];
