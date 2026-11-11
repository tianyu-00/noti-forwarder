import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/helpers/global-setup.js'],
    testTimeout: 30000,
    hookTimeout: 120000,
  },
});
