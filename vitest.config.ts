import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'web/src/**/*.test.{ts,tsx}', 'cli/test/**/*.test.ts'],
    environment: 'node',
  },
});
