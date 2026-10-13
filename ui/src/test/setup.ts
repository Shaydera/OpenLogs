import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Component tests run without game data: every icon shows its reference as the image source.
vi.mock('../icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../icons')>()),
  useIconSrc: (ref: string | null) => ref,
}));

afterEach(() => cleanup());
