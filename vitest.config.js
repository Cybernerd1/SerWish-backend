import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    env: { NODE_ENV: 'test' },
    testTimeout: 10000,
    pool: 'forks',
    // Integration files share one database and the dispatcher's advisory lock.
    fileParallelism: false,
  },
});
