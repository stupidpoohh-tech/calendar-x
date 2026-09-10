import { defineConfig } from 'vitest/config';

/**
 * 에뮬레이터가 필요한 테스트를 기본 테스트와 분리한다.
 *   rules.test.ts                  보안 규칙 자체
 *   restore.emulator.test.ts       복원 순서를 진짜 저장소 위에서
 *   pendingWrites.emulator.test.ts 규칙 거절 뒤에 무엇이 남는가
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/test/rules.test.ts',
      'src/test/restore.emulator.test.ts',
      'src/test/pendingWrites.emulator.test.ts',
    ],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
