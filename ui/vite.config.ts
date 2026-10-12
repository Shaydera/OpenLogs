import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // brand/ holds the logo files that AppLogo.test.tsx compares the wordmark against.
  server: { port: 5173, strictPort: true, fs: { allow: ['.', '../brand'] } },
  build: { target: 'es2022' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Lets tests read stylesheets with `?raw` (otherwise CSS imports are empty in Vitest).
    css: true,
  },
});
