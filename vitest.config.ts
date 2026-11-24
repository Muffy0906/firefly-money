import { defineConfig } from 'vitest/config';

// Unit tests for the app's pure logic (npm test). The page-level checks live in dev/smoke_test.py.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
  },
});
