import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Forces the session cache off, pins its path into a temp dir, and fails the
    // suite if anything reached the real ~/.infinitecampus-mcp — see tests/_setup.ts.
    setupFiles: ['./tests/_setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
