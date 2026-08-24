/**
 * Firebase 오류를 사람이 읽고 다음 행동을 알 수 있는 문장으로 옮긴다.
 *
 * "Missing or insufficient permissions." 는 사실이지만 아무것도 알려주지 않는다.
 * 이 프로젝트의 원칙은 조용히 실패하지 않는 것인데, 시끄럽게 실패하면서
 * 원인을 감추는 것도 같은 문제다.
 */
import { FirebaseError } from 'firebase/app';

export const RULES_DEPLOY_COMMAND = 'npx firebase deploy --only firestore:rules';

/** 터미널을 쓰지 않는 사람에게는 콘솔에 붙여넣는 쪽이 빠르다. */
export const RULES_CONSOLE_PATH = 'Firebase 콘솔 → Firestore Database → 규칙 탭 → 붙여넣고 게시';

export function errorCode(err: unknown): string {
  return err instanceof FirebaseError ? err.code : '';
}

/** 보안 규칙이 배포되지 않아 생긴 문제인가. 배포 직후 가장 흔한 실패다. */
export function isPermissionDenied(err: unknown): boolean {
  const code = errorCode(err);
  return code === 'permission-denied' || code === 'firestore/permission-denied';
}

export function describeFirestoreError(err: unknown): string {
  const code = errorCode(err);
  switch (code) {
    case 'permission-denied':
    case 'firestore/permission-denied':
      return '보안 규칙이 이 작업을 허용하지 않습니다.';
    case 'unavailable':
    case 'firestore/unavailable':
      return '서버에 연결할 수 없습니다. 네트워크를 확인해 주세요. 오프라인 상태에서는 저장한 내용이 연결되면 자동으로 전송됩니다.';
    case 'unauthenticated':
    case 'firestore/unauthenticated':
      return '로그인이 만료되었습니다. 다시 로그인해 주세요.';
    case 'failed-precondition':
    case 'firestore/failed-precondition':
      return '이 조회에 필요한 Firestore 색인이 없습니다. 브라우저 콘솔의 링크로 색인을 만들어 주세요.';
    case 'resource-exhausted':
    case 'firestore/resource-exhausted':
      return 'Firebase 사용 한도를 넘었습니다. 요금제와 할당량을 확인해 주세요.';
    case 'invalid-argument':
    case 'firestore/invalid-argument':
      return '저장하려는 값의 형태가 올바르지 않습니다.';
    default:
      return err instanceof Error ? err.message : String(err);
  }
}
