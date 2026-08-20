import { defineConfig } from 'vitest/config';

/** 규칙 테스트는 에뮬레이터가 필요하므로 기본 테스트와 분리한다. */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/test/rules.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
