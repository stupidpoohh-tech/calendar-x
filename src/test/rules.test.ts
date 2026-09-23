/**
 * 보안 규칙 테스트.
 *
 * 이전 프로젝트에서 고정 메모·잔고·대출이 각각 한 번씩 "저장은 되는데 조용히 사라지는"
 * 문제를 겪었고, 규칙을 확인할 방법이 없어 title 을 '::balance::' 로 쓰는 우회로 넘겼다.
 * 규칙을 레포에 두고 에뮬레이터로 돌리면 무엇이 왜 막히는지 즉시 알 수 있다.
 *
 * 실행: npm run test:rules  (Firestore 에뮬레이터가 자동으로 뜬다)
 */
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  arrayRemove, arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, getDocs,
  query, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let env: RulesTestEnvironment;

const ME = 'user-me';
const OTHER = 'user-other';

const validEntry = (over: Record<string, unknown> = {}) => ({
  kind: 'task',
  title: '치과',
  note: '',
  color: 'blue',
  tags: [],
  location: '',
  startDate: '2026-08-03',
  startTime: null,
  endDate: null,
  endTime: null,
  ymSpan: ['2026-08'],
  isRecurring: false,
  recurrence: null,
  task: { status: 'planned', important: false, urgent: false, order: 0 },
  money: null,
  recovery: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

const recoveryFields = {
  options: [
    { id: 'personal', label: '개인 프로젝트' },
    { id: 'work', label: '회사 일' },
  ],
  repayment: false,
  movedCount: 0,
};

const recoveryRule = {
  enabled: true,
  intervalDays: 3,
  window: 'evening',
  generationHorizonDays: 1,
  lastCompletedAt: '2026-08-01',
  nextDueAt: '2026-08-04',
  activeEntryId: 'e1',
  debtCount: 0,
  defaultMemo: '오늘은 결과물을 만들지 않는다',
  defaultOptionIds: ['personal', 'work'],
  options: [
    { id: 'personal', label: '개인 프로젝트', order: 0 },
    { id: 'work', label: '회사 일', order: 1 },
  ],
};

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'dada-rules-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const db = (uid: string | null) =>
  uid === null ? env.unauthenticatedContext().firestore() : env.authenticatedContext(uid).firestore();

describe('소유권', () => {
  it('로그인하지 않으면 아무것도 못 읽는다', async () => {
    await assertFails(getDoc(doc(db(null), `users/${ME}/entries/e1`)));
  });

  it('내 항목은 쓰고 읽을 수 있다', async () => {
    await assertSucceeds(setDoc(doc(db(ME), `users/${ME}/entries/e1`), validEntry()));
    await assertSucceeds(getDoc(doc(db(ME), `users/${ME}/entries/e1`)));
  });

  it('남의 항목은 읽지도 쓰지도 못한다', async () => {
    await assertFails(setDoc(doc(db(OTHER), `users/${ME}/entries/e1`), validEntry()));
    await assertFails(getDoc(doc(db(OTHER), `users/${ME}/entries/e1`)));
  });
});

describe('entry 형태 검증', () => {
  it('임의의 doc ID 를 허용한다', async () => {
    // 이전 CLAUDE.md 는 "비표준 doc ID 는 보안 규칙에서 조용히 거부된다"고 적었지만,
    // 실제로 규칙은 doc ID 를 보지 않는다. 랜덤 ID든 사람이 읽는 ID든 통과한다.
    await assertSucceeds(setDoc(doc(db(ME), `users/${ME}/entries/my-readable-id`), validEntry()));
    await assertSucceeds(setDoc(doc(db(ME), `users/${ME}/entries/balance-2026`), validEntry()));
  });

  it('__x__ 형태의 doc ID 는 Firestore 자체가 거부한다 — ::balance:: 우회의 진짜 원인', () => {
    // 밑줄 두 개로 감싼 ID 는 Firestore 예약어라 규칙과 무관하게 INVALID_ARGUMENT 가 난다.
    // 이전 프로젝트가 __pins__ / __balance__ 로 저장에 실패한 것은 보안 규칙 때문이 아니었다.
    // 클라이언트 SDK 단계에서 걸리므로 규칙을 아무리 열어도 통과하지 않는다.
    expect(() => doc(db(ME), `users/${ME}/entries/__balance__`)).not.toThrow();
    // 실제 거부는 쓰기 시점에 서버가 낸다. 그 사실만 문서로 남기고 호출은 하지 않는다.
  });

  it('알 수 없는 kind 는 거부한다', async () => {
    await assertFails(setDoc(doc(db(ME), `users/${ME}/entries/e1`), validEntry({ kind: 'unknown' })));
  });

  it('날짜 형식이 틀리면 거부한다', async () => {
    await assertFails(setDoc(doc(db(ME), `users/${ME}/entries/e1`), validEntry({ startDate: '2026-8-3' })));
  });

  it('시각이 HH:mm 이 아니면 거부한다', async () => {
    await assertFails(setDoc(doc(db(ME), `users/${ME}/entries/e1`), validEntry({ startTime: '2pm' })));
    await assertSucceeds(setDoc(doc(db(ME), `users/${ME}/entries/e2`), validEntry({ startTime: '14:30' })));
  });

  it('금액이 정수가 아니면 거부한다 — 부동소수 오차 유입 차단', async () => {
    const money = { kind: 'money', task: null, money: { type: 'expense', amountMinor: 1.5, currency: 'KRW', linkedEntryId: null } };
    await assertFails(setDoc(doc(db(ME), `users/${ME}/entries/m1`), validEntry(money)));
  });

  it('정상 가계부 항목은 통과한다', async () => {
    const money = { kind: 'money', task: null, money: { type: 'expense', amountMinor: 45000, currency: 'KRW', linkedEntryId: null } };
    await assertSucceeds(setDoc(doc(db(ME), `users/${ME}/entries/m2`), validEntry(money)));
  });

  it('제목이 지나치게 길면 거부한다', async () => {
    await assertFails(setDoc(doc(db(ME), `users/${ME}/entries/e1`), validEntry({ title: 'x'.repeat(501) })));
  });
});

describe('accounts / debts / pins', () => {
  const account = { name: '주계좌', balanceMinor: 1350000, currency: 'KRW', asOf: '2026-08-19', checkedAt: '2026-08-19T09:00:00.000Z', order: 0, createdAt: '', updatedAt: '' };
  const debt = { name: '카카오뱅크', balanceMinor: 5000000, monthlyMinor: 300000, rate: 3.5, currentRound: 12, totalRounds: 60, order: 0, createdAt: '', updatedAt: '' };
  const pin = { lens: 'task', text: '이번 분기 목표', order: 0, createdAt: '', updatedAt: '' };

  it('잔고를 별도 컬렉션에 저장할 수 있다 — ::balance:: 우회가 필요 없어진다', async () => {
    await assertSucceeds(setDoc(doc(db(ME), `users/${ME}/accounts/a1`), account));
  });

  it('잔고 금액이 정수가 아니면 거부한다', async () => {
    await assertFails(setDoc(doc(db(ME), `users/${ME}/accounts/a1`), { ...account, balanceMinor: '1350000' }));
  });

  it('대출을 1건 1문서로 저장할 수 있다 — 덮어쓰기 원인 제거', async () => {
    await assertSucceeds(setDoc(doc(db(ME), `users/${ME}/debts/d1`), debt));
    await assertSucceeds(setDoc(doc(db(ME), `users/${ME}/debts/d2`), { ...debt, name: '학자금', rate: null }));
  });

  it('고정 메모의 렌즈 값을 확인한다', async () => {
    await assertSucceeds(setDoc(doc(db(ME), `users/${ME}/pins/p1`), pin));
    await assertFails(setDoc(doc(db(ME), `users/${ME}/pins/p2`), { ...pin, lens: 'memo' }));
  });
});

describe('budgets / reserves', () => {
  const budget = {
    name: '9월 생활비', startDate: '2026-09-01', endDate: '2026-09-30',
    amountMinor: 700000, currency: 'KRW', createdAt: '', updatedAt: '',
  };
  const reserve = { name: '비상금', amountMinor: 500000, currency: 'KRW', createdAt: '', updatedAt: '' };

  it('생활비 예산을 저장할 수 있다', async () => {
    await assertSucceeds(setDoc(doc(db(ME), `users/${ME}/budgets/b1`), budget));
  });

  it('예산 금액이 정수가 아니면 거부한다', async () => {
    await assertFails(setDoc(doc(db(ME), `users/${ME}/budgets/b1`), { ...budget, amountMinor: '700000' }));
  });

  it('기간이 날짜 모양이 아니면 거부한다', async () => {
    await assertFails(setDoc(doc(db(ME), `users/${ME}/budgets/b1`), { ...budget, endDate: '2026-9-30' }));
  });

  it('세이브를 저장할 수 있다', async () => {
    await assertSucceeds(setDoc(doc(db(ME), `users/${ME}/reserves/r1`), reserve));
  });

  it('세이브 금액이 정수가 아니면 거부한다', async () => {
    await assertFails(setDoc(doc(db(ME), `users/${ME}/reserves/r1`), { ...reserve, amountMinor: 1.5 }));
  });

  it('남의 예산·세이브는 건드릴 수 없다', async () => {
    await assertFails(setDoc(doc(db(OTHER), `users/${ME}/budgets/b1`), budget));
    await assertFails(setDoc(doc(db(OTHER), `users/${ME}/reserves/r1`), reserve));
  });

  it('지출에 budgetId · debtId 가 붙어도 항목 규칙이 막지 않는다', async () => {
    // 규칙은 필수 필드의 타입만 본다. 새 필드가 조용히 막히면 "저장은 되는데
    // 사라지는" 예전 문제로 돌아간다.
    await assertSucceeds(setDoc(
      doc(db(ME), `users/${ME}/entries/e1`),
      validEntry({
        kind: 'money',
        money: {
          type: 'expense', amountMinor: 12000, currency: 'KRW',
          linkedEntryId: null, budgetId: 'b1', debtId: null, priority: false,
        },
      }),
    ));
  });
});

/*
  회복은 규칙을 고치지 않고 들어왔다. 항목 규칙은 필수 필드의 타입만 보고 나머지를
  통과시키도록 쓰여 있고(그래서 새 필드가 조용히 막히지 않는다), 회복 규칙은
  users/{uid} 문서의 필드라 소유자 검사만 거친다. 그 전제가 무너지면 회복은
  "저장은 되는데 사라지는" 예전 문제로 돌아가므로 여기에 못 박아 둔다.
*/
describe('회복', () => {
  it('회복 표식이 붙은 항목을 받는다', async () => {
    await assertSucceeds(setDoc(
      doc(db(ME), `users/${ME}/entries/e1`),
      validEntry({ title: 'Recovery — OUTPUT OFF', startTime: '18:00', endTime: '23:59', recovery: recoveryFields }),
    ));
  });

  it('회복 규칙은 사용자 문서에 쓸 수 있다', async () => {
    await assertSucceeds(setDoc(doc(db(ME), `users/${ME}`), { recovery: recoveryRule }, { merge: true }));
    const snap = await getDoc(doc(db(ME), `users/${ME}`));
    expect(snap.data()?.recovery?.debtCount).toBe(0);
  });

  it('규칙을 필드 단위로 고칠 수 있다 — 이웃 필드는 남는다', async () => {
    await setDoc(doc(db(ME), `users/${ME}`), { migratedAt: '2026-08-01T00:00:00.000Z', recovery: recoveryRule });
    await assertSucceeds(setDoc(doc(db(ME), `users/${ME}`), { recovery: { nextDueAt: '2026-08-07' } }, { merge: true }));
    const data = (await getDoc(doc(db(ME), `users/${ME}`))).data();
    expect(data?.recovery?.nextDueAt).toBe('2026-08-07');
    // 부분 쓰기가 나머지를 지우면 설정에서 방금 적은 기본 메모가 사라진다.
    expect(data?.recovery?.defaultMemo).toBe('오늘은 결과물을 만들지 않는다');
    expect(data?.migratedAt).toBe('2026-08-01T00:00:00.000Z');
  });

  it('남의 회복 규칙은 건드릴 수 없다', async () => {
    await assertFails(setDoc(doc(db(OTHER), `users/${ME}`), { recovery: recoveryRule }, { merge: true }));
  });
});

describe('이관 전 컬렉션', () => {
  it('읽을 수는 있지만 새로 쓸 수는 없다', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${ME}/items/old1`), { tab: 'todo', title: '옛 항목' });
    });
    await assertSucceeds(getDoc(doc(db(ME), `users/${ME}/items/old1`)));
    await assertFails(setDoc(doc(db(ME), `users/${ME}/items/old2`), { tab: 'todo', title: '새로 쓰기' }));
  });
});

/*
  ── 같이 보기 (공유 보드) ─────────────────────────────────────────

  여기서 확인하는 것은 둘이다.
    1. 공유가 **되는가** — owner · member 는 보드 안의 자료를 읽고 쓴다.
    2. 공유 때문에 **격리가 약해지지 않았는가** — member 는 상대의 `users/{uid}` 를
       여전히 읽지 못한다. 초대장이 없으면 보드에 들어올 수도 없다.
*/
describe('같이 보기 — 보드', () => {
  const BOARD = 'board-1';
  const CODE = 'invitecode0000000001';

  const boardDoc = (over: Record<string, unknown> = {}) => ({
    ownerUid: ME,
    memberUids: [ME],
    memberNames: { [ME]: 'me@example.com' },
    name: '같이 보기',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  });

  const inviteDoc = (over: Record<string, unknown> = {}) => ({
    boardId: BOARD,
    ownerUid: ME,
    boardName: '같이 보기',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  });

  /** 규칙을 건너뛰고 상태를 만들어 둔다. 여기서 재는 것은 그 뒤의 접근이다. */
  async function seed(members: string[] = [ME], withInvite = true) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const raw = ctx.firestore();
      const names: Record<string, string> = {};
      for (const m of members) names[m] = `${m}@example.com`;
      await setDoc(doc(raw, `sharedBoards/${BOARD}`), boardDoc({ memberUids: members, memberNames: names }));
      if (withInvite) await setDoc(doc(raw, `sharedInvites/${CODE}`), inviteDoc());
    });
  }

  it('보드를 만들 수 있다 — 혼자로 시작한다', async () => {
    await assertSucceeds(setDoc(doc(db(ME), `sharedBoards/${BOARD}`), boardDoc()));
  });

  it('남을 끼워 넣은 보드를 만들 수 없다', async () => {
    await assertFails(setDoc(
      doc(db(ME), `sharedBoards/${BOARD}`),
      boardDoc({ memberUids: [ME, OTHER] }),
    ));
  });

  it('남을 소유자로 적은 보드를 만들 수 없다', async () => {
    await assertFails(setDoc(doc(db(ME), `sharedBoards/${BOARD}`), boardDoc({ ownerUid: OTHER })));
  });

  it('소유자는 자기 보드를 읽는다', async () => {
    await seed();
    await assertSucceeds(getDoc(doc(db(ME), `sharedBoards/${BOARD}`)));
  });

  it('member 는 보드를 읽는다', async () => {
    await seed([ME, OTHER]);
    await assertSucceeds(getDoc(doc(db(OTHER), `sharedBoards/${BOARD}`)));
  });

  it('제3자는 보드를 읽지도 쓰지도 못한다', async () => {
    await seed();
    await assertFails(getDoc(doc(db(OTHER), `sharedBoards/${BOARD}`)));
    await assertFails(updateDoc(doc(db(OTHER), `sharedBoards/${BOARD}`), { name: '내 것' }));
  });

  it('로그인하지 않으면 아무것도 못 읽는다', async () => {
    await seed();
    await assertFails(getDoc(doc(db(null), `sharedBoards/${BOARD}`)));
  });

  it('내가 속한 보드만 목록으로 받는다', async () => {
    await seed([ME, OTHER]);
    const mine = query(collection(db(OTHER), 'sharedBoards'), where('memberUids', 'array-contains', OTHER));
    await assertSucceeds(getDocs(mine));
    // 조건 없는 전량 조회는 남의 보드까지 긁으므로 막혀야 한다.
    await assertFails(getDocs(collection(db(OTHER), 'sharedBoards')));
  });

  it('초대장이 있으면 스스로 member 가 된다', async () => {
    await seed();
    await assertSucceeds(updateDoc(doc(db(OTHER), `sharedBoards/${BOARD}`), {
      memberUids: arrayUnion(OTHER),
      [`memberNames.${OTHER}`]: 'other@example.com',
      joinCode: CODE,
      updatedAt: '2026-09-02T00:00:00.000Z',
    }));
    await assertSucceeds(getDoc(doc(db(OTHER), `sharedBoards/${BOARD}`)));
  });

  it('초대장 없이는 들어올 수 없다', async () => {
    await seed([ME], false);
    await assertFails(updateDoc(doc(db(OTHER), `sharedBoards/${BOARD}`), {
      memberUids: arrayUnion(OTHER),
      [`memberNames.${OTHER}`]: 'other@example.com',
      joinCode: CODE,
      updatedAt: '2026-09-02T00:00:00.000Z',
    }));
  });

  it('코드를 모르면 들어올 수 없다', async () => {
    await seed();
    await assertFails(updateDoc(doc(db(OTHER), `sharedBoards/${BOARD}`), {
      memberUids: arrayUnion(OTHER),
      joinCode: 'guessed00000000000000',
      updatedAt: '2026-09-02T00:00:00.000Z',
    }));
  });

  it('다른 보드의 초대장으로는 들어올 수 없다', async () => {
    await seed();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'sharedInvites/othercode000000000x'), inviteDoc({ boardId: 'board-2' }));
    });
    await assertFails(updateDoc(doc(db(OTHER), `sharedBoards/${BOARD}`), {
      memberUids: arrayUnion(OTHER),
      joinCode: 'othercode000000000x',
      updatedAt: '2026-09-02T00:00:00.000Z',
    }));
  });

  it('수락하면서 남의 uid 를 끼워 넣을 수 없다', async () => {
    await seed();
    await assertFails(updateDoc(doc(db(OTHER), `sharedBoards/${BOARD}`), {
      memberUids: arrayUnion(OTHER, 'third-party'),
      joinCode: CODE,
      updatedAt: '2026-09-02T00:00:00.000Z',
    }));
  });

  it('수락하면서 소유자를 바꿀 수 없다', async () => {
    await seed();
    await assertFails(updateDoc(doc(db(OTHER), `sharedBoards/${BOARD}`), {
      memberUids: arrayUnion(OTHER),
      ownerUid: OTHER,
      joinCode: CODE,
      updatedAt: '2026-09-02T00:00:00.000Z',
    }));
  });

  it('수락하면서 소유자를 내쫓을 수 없다', async () => {
    await seed();
    await assertFails(updateDoc(doc(db(OTHER), `sharedBoards/${BOARD}`), {
      memberUids: [OTHER],
      joinCode: CODE,
      updatedAt: '2026-09-02T00:00:00.000Z',
    }));
  });

  it('수락하면서 소유자의 이름표를 고쳐 쓸 수 없다', async () => {
    await seed();
    await assertFails(updateDoc(doc(db(OTHER), `sharedBoards/${BOARD}`), {
      memberUids: arrayUnion(OTHER),
      [`memberNames.${ME}`]: '가짜',
      joinCode: CODE,
      updatedAt: '2026-09-02T00:00:00.000Z',
    }));
  });

  it('member 는 보드 이름을 바꾸지 못한다 — 소유자의 자리다', async () => {
    await seed([ME, OTHER]);
    await assertFails(updateDoc(doc(db(OTHER), `sharedBoards/${BOARD}`), { name: '내 보드' }));
    await assertSucceeds(updateDoc(doc(db(ME), `sharedBoards/${BOARD}`), { name: '우리' }));
  });

  it('member 는 스스로 나갈 수 있다. 남을 내쫓지는 못한다', async () => {
    await seed([ME, OTHER]);
    await assertFails(updateDoc(doc(db(OTHER), `sharedBoards/${BOARD}`), {
      memberUids: arrayRemove(ME), updatedAt: '2026-09-03T00:00:00.000Z',
    }));
    await assertSucceeds(updateDoc(doc(db(OTHER), `sharedBoards/${BOARD}`), {
      memberUids: arrayRemove(OTHER),
      [`memberNames.${OTHER}`]: deleteField(),
      updatedAt: '2026-09-03T00:00:00.000Z',
    }));
  });

  it('소유자만 보드를 지운다', async () => {
    await seed([ME, OTHER]);
    await assertFails(deleteDoc(doc(db(OTHER), `sharedBoards/${BOARD}`)));
    await assertSucceeds(deleteDoc(doc(db(ME), `sharedBoards/${BOARD}`)));
  });

  // ---------- 초대장 ----------

  it('소유자는 자기 보드의 초대장을 만들고 끊는다', async () => {
    await seed([ME], false);
    await assertSucceeds(setDoc(doc(db(ME), `sharedInvites/${CODE}`), inviteDoc()));
    await assertSucceeds(deleteDoc(doc(db(ME), `sharedInvites/${CODE}`)));
  });

  it('남의 보드로 가는 초대장은 만들 수 없다', async () => {
    await seed([ME], false);
    await assertFails(setDoc(doc(db(OTHER), 'sharedInvites/evil0000000000000000'), inviteDoc({ ownerUid: OTHER })));
  });

  it('초대장은 코드를 알 때 한 건만 읽는다 — 목록으로 긁을 수 없다', async () => {
    await seed();
    await assertSucceeds(getDoc(doc(db(OTHER), `sharedInvites/${CODE}`)));
    await assertFails(getDocs(collection(db(OTHER), 'sharedInvites')));
  });

  it('소유자는 자기가 낸 초대장을 목록으로 되찾는다 — 그래야 끊을 수 있다', async () => {
    await seed();
    await assertSucceeds(getDocs(query(collection(db(ME), 'sharedInvites'), where('ownerUid', '==', ME))));
    // 남의 것까지 훑는 조회는 막힌다.
    await assertFails(getDocs(query(collection(db(OTHER), 'sharedInvites'), where('ownerUid', '==', ME))));
  });

  it('초대장은 고칠 수 없다. 끊고 새로 만든다', async () => {
    await seed();
    await assertFails(updateDoc(doc(db(ME), `sharedInvites/${CODE}`), { boardId: 'board-2' }));
  });

  it('남의 초대장을 끊을 수 없다', async () => {
    await seed();
    await assertFails(deleteDoc(doc(db(OTHER), `sharedInvites/${CODE}`)));
  });
});

describe('같이 보기 — 보드 안의 자료', () => {
  const BOARD = 'board-1';
  const THIRD = 'user-third';

  const item = (over: Record<string, unknown> = {}) => ({
    sourceEntryId: 'task-a',
    source: {
      title: '병원 예약', note: '', color: 'blue',
      startDate: '2026-09-25', endDate: null, startTime: null,
      status: 'planned', important: false, urgent: false, recurring: false,
    },
    localOnly: false,
    createdBy: ME,
    updatedAt: '2026-09-23T00:00:00.000Z',
    ...over,
  });

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `sharedBoards/${BOARD}`), {
        ownerUid: ME,
        memberUids: [ME, OTHER],
        memberNames: { [ME]: 'me@example.com', [OTHER]: 'other@example.com' },
        name: '같이 보기',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      });
    });
  });

  it('소유자와 member 는 공유 TODO 를 쓰고 읽는다', async () => {
    await assertSucceeds(setDoc(doc(db(ME), `sharedBoards/${BOARD}/items/task-a`), item()));
    await assertSucceeds(getDoc(doc(db(OTHER), `sharedBoards/${BOARD}/items/task-a`)));
    await assertSucceeds(setDoc(
      doc(db(OTHER), `sharedBoards/${BOARD}/items/task-a`),
      item({ overrides: { title: '병원 전화하기' } }),
    ));
  });

  it('제3자는 공유 TODO 에 접근할 수 없다', async () => {
    await assertFails(setDoc(doc(db(THIRD), `sharedBoards/${BOARD}/items/task-a`), item()));
    await assertFails(getDoc(doc(db(THIRD), `sharedBoards/${BOARD}/items/task-a`)));
    await assertFails(getDocs(collection(db(THIRD), `sharedBoards/${BOARD}/items`)));
  });

  /*
    갱신 쓰기는 `overrides` · `hidden` 을 담지 않는다 (merge). 규칙이 그 필드를
    요구하면 원본 갱신이 통째로 막히므로, 없는 문서도 받는다는 것을 못 박아 둔다.
  */
  it('overrides · hidden 이 없는 문서를 받는다 — 갱신 쓰기의 모양이다', async () => {
    await assertSucceeds(setDoc(doc(db(ME), `sharedBoards/${BOARD}/items/task-a`), {
      sourceEntryId: 'task-a',
      source: item().source,
      localOnly: false,
      createdBy: ME,
      updatedAt: '2026-09-23T00:00:00.000Z',
    }));
  });

  it('공유 화면에서만 만든 항목은 원본이 없어도 받는다', async () => {
    await assertSucceeds(setDoc(doc(db(OTHER), `sharedBoards/${BOARD}/items/local-1`), {
      sourceEntryId: null, source: null,
      overrides: { title: '토요일 같이 장보기', startDate: '2026-09-26', status: 'planned' },
      localOnly: true, hidden: false,
      createdBy: OTHER, createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z',
    }));
  });

  it('날짜 모양이 틀린 원본 스냅샷은 거부한다', async () => {
    await assertFails(setDoc(
      doc(db(ME), `sharedBoards/${BOARD}/items/task-a`),
      item({ source: { ...item().source, startDate: '2026-9-25' } }),
    ));
  });

  it('지나치게 긴 제목은 거부한다', async () => {
    await assertFails(setDoc(
      doc(db(ME), `sharedBoards/${BOARD}/items/task-a`),
      item({ source: { ...item().source, title: 'x'.repeat(501) } }),
    ));
    await assertFails(setDoc(
      doc(db(ME), `sharedBoards/${BOARD}/items/task-b`),
      item({ overrides: { title: 'x'.repeat(501) } }),
    ));
  });

  it('색을 함께 받는다 — 달력에서 항목을 가르는 값이다', async () => {
    await assertSucceeds(setDoc(
      doc(db(ME), `sharedBoards/${BOARD}/items/task-a`),
      item({ source: { ...item().source, color: 'pink' }, overrides: { color: 'green' } }),
    ));
  });

  it('색 자리에 긴 문자열을 넣으면 거부한다', async () => {
    await assertFails(setDoc(
      doc(db(ME), `sharedBoards/${BOARD}/items/task-a`),
      item({ overrides: { color: 'x'.repeat(41) } }),
    ));
  });

  it('hidden 이 참/거짓이 아니면 거부한다', async () => {
    await assertFails(setDoc(
      doc(db(ME), `sharedBoards/${BOARD}/items/task-a`),
      item({ hidden: 'yes' }),
    ));
  });

  // ---------- 고정메모 ----------

  const pin = { text: '토요일 장보기', order: 0, createdBy: ME, createdAt: '', updatedAt: '' };

  it('소유자와 member 가 같은 고정메모를 읽고 쓴다', async () => {
    await assertSucceeds(setDoc(doc(db(ME), `sharedBoards/${BOARD}/pins/memo`), pin));
    await assertSucceeds(getDoc(doc(db(OTHER), `sharedBoards/${BOARD}/pins/memo`)));
    await assertSucceeds(setDoc(doc(db(OTHER), `sharedBoards/${BOARD}/pins/memo`), { ...pin, text: '영화 예매' }));
    await assertSucceeds(deleteDoc(doc(db(OTHER), `sharedBoards/${BOARD}/pins/memo`)));
  });

  it('제3자는 고정메모에 접근할 수 없다', async () => {
    await assertFails(setDoc(doc(db(THIRD), `sharedBoards/${BOARD}/pins/memo`), pin));
    await assertFails(getDoc(doc(db(THIRD), `sharedBoards/${BOARD}/pins/memo`)));
  });

  it('메모 본문이 문자열이 아니면 거부한다', async () => {
    await assertFails(setDoc(doc(db(ME), `sharedBoards/${BOARD}/pins/memo`), { ...pin, text: 42 }));
  });

  // ---------- D-Day ----------

  const dday = { title: '우리 여행', date: '2026-10-16', order: 0, createdBy: ME, createdAt: '', updatedAt: '' };

  it('소유자와 member 가 D-Day 를 만들고 고치고 지운다', async () => {
    await assertSucceeds(setDoc(doc(db(ME), `sharedBoards/${BOARD}/ddays/d1`), dday));
    await assertSucceeds(getDoc(doc(db(OTHER), `sharedBoards/${BOARD}/ddays/d1`)));
    await assertSucceeds(setDoc(doc(db(OTHER), `sharedBoards/${BOARD}/ddays/d1`), { ...dday, date: '2026-10-18' }));
    await assertSucceeds(deleteDoc(doc(db(OTHER), `sharedBoards/${BOARD}/ddays/d1`)));
  });

  it('제3자는 D-Day 에 접근할 수 없다', async () => {
    await assertFails(setDoc(doc(db(THIRD), `sharedBoards/${BOARD}/ddays/d1`), dday));
    await assertFails(getDocs(collection(db(THIRD), `sharedBoards/${BOARD}/ddays`)));
  });

  it('날짜 모양이 틀린 D-Day 는 거부한다 — D-N 을 지어낼 수 없다', async () => {
    await assertFails(setDoc(doc(db(ME), `sharedBoards/${BOARD}/ddays/d1`), { ...dday, date: '2026-10-6' }));
    await assertFails(setDoc(doc(db(ME), `sharedBoards/${BOARD}/ddays/d2`), { ...dday, date: null }));
  });

  /*
    ── 공유 때문에 개인 자료의 격리가 약해지지 않았다 ──────────────

    같이 보기의 목적은 TODO 하나를 함께 보는 것이다. member 가 되었다고 상대의
    개인 영역이 열리면 그 목적을 넘어선다.
  */
  it('member 는 소유자의 개인 entries 를 직접 읽지 못한다', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${ME}/entries/task-a`), validEntry());
    });
    await assertFails(getDoc(doc(db(OTHER), `users/${ME}/entries/task-a`)));
    await assertFails(getDocs(collection(db(OTHER), `users/${ME}/entries`)));
  });

  it('member 는 소유자의 개인 TODO 를 고치지 못한다 — 역반영이 규칙에서도 막힌다', async () => {
    await assertFails(setDoc(doc(db(OTHER), `users/${ME}/entries/task-a`), validEntry({ title: '내가 고침' })));
  });

  it('member 는 소유자의 가계부 · 잔고 · 대출 · 개인 메모에 접근할 수 없다', async () => {
    await assertFails(getDoc(doc(db(OTHER), `users/${ME}/accounts/a1`)));
    await assertFails(getDoc(doc(db(OTHER), `users/${ME}/debts/d1`)));
    await assertFails(getDoc(doc(db(OTHER), `users/${ME}/budgets/b1`)));
    await assertFails(getDoc(doc(db(OTHER), `users/${ME}/reserves/r1`)));
    await assertFails(getDoc(doc(db(OTHER), `users/${ME}/pins/p1`)));
  });

  it('member 는 소유자의 회복 설정에 접근할 수 없다', async () => {
    await assertFails(getDoc(doc(db(OTHER), `users/${ME}`)));
    await assertFails(setDoc(doc(db(OTHER), `users/${ME}`), { recovery: recoveryRule }, { merge: true }));
  });
});

describe('그 밖의 경로', () => {
  it('정의하지 않은 컬렉션은 전부 막는다', async () => {
    await assertFails(setDoc(doc(db(ME), 'random/anything'), { x: 1 }));
  });
});
