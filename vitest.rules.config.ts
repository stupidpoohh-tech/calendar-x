import { defineConfig } from 'vitest/config';

/**
 * 에뮬레이터가 필요한 테스트를 기본 테스트와 분리한다.
 *   rules.test.ts                  보안 규칙 자체
 *   restore.emulator.test.ts       복원 순서를 진짜 저장소 위에서
 *   pendingWrites.emulator.test.ts 규칙 거절 뒤에 무엇이 남는가
 *   shared.emulator.test.ts        같이 보기 — merge 갱신이 상대의 수정을 남기는가,
 *                                  공유 화면의 편집이 원본에 닿지 않는가
 *   ledger.emulator.test.ts        가계부 원장 — 30달 넘는 창의 분할 조회 · 확정 거래 조회
 *   backup.emulator.test.ts        백업 · 복원 왕복 — 모든 갈래 · 계산 결과 · 건수 · 예전 버전
 *   ledgerImport.emulator.test.ts  가계부 이관 — 엑셀 → 실제 거래, 재가져오기 0건, 백업 왕복
 *   relink.emulator.test.ts        예정 수정 시 확정 거래 다시 잇기 — 한 배치 · 옛 백업 무중복
 *   pocket.emulator.test.ts        생활비 기간 변경 · 삭제 — 걸린 거래 찾기 · 주머니와 연결을 한 배치로
 *   pastPlanned.emulator.test.ts   지난 예정 정리 — 후보만 지우고 숫자 그대로, 백업으로 되돌린다
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/test/rules.test.ts',
      'src/test/restore.emulator.test.ts',
      'src/test/pendingWrites.emulator.test.ts',
      'src/test/shared.emulator.test.ts',
      'src/test/ledger.emulator.test.ts',
      'src/test/backup.emulator.test.ts',
      'src/test/ledgerImport.emulator.test.ts',
      'src/test/relink.emulator.test.ts',
      'src/test/pocket.emulator.test.ts',
      'src/test/pastPlanned.emulator.test.ts',
      'src/test/reserve.emulator.test.ts',
      'src/test/card.emulator.test.ts',
      'src/test/deviceBackup.emulator.test.ts',
    ],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
