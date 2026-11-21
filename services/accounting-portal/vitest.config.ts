import { defineConfig } from 'vitest/config';

// Tests run at the Portal da Contabilidade's boundary (seam 2): real HTTP in, real Postgres and
// RabbitMQ in containers, commands observed on the robot's queue.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
