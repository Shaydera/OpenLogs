import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // brand/ holds the logo files that AppLogo.test.tsx compares the wordmark against; the class and
  // spec icons come from the game data crate.
  server: { port: 5173, strictPort: true, fs: { allow: ['.', '../brand', '../crates/openlogs-gamedata/data'] } },
  build: { target: 'es2022' },
  test: {
    environment: 'jsdom',
    // Creates jsdom once per worker instead of once per test file, which took most of the test run.
    pool: 'vmThreads',
    setupFiles: ['./src/test/setup.ts'],
    // Lets tests read stylesheets with `?raw` (otherwise CSS imports are empty in Vitest).
    css: true,
  },
});
