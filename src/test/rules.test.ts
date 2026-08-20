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
import { doc, getDoc, setDoc } from 'firebase/firestore';
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
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

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
  const account = { name: '주계좌', balanceMinor: 1350000, currency: 'KRW', asOf: '2026-08-19', order: 0, createdAt: '', updatedAt: '' };
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

describe('이관 전 컬렉션', () => {
  it('읽을 수는 있지만 새로 쓸 수는 없다', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${ME}/items/old1`), { tab: 'todo', title: '옛 항목' });
    });
    await assertSucceeds(getDoc(doc(db(ME), `users/${ME}/items/old1`)));
    await assertFails(setDoc(doc(db(ME), `users/${ME}/items/old2`), { tab: 'todo', title: '새로 쓰기' }));
  });
});

describe('그 밖의 경로', () => {
  it('정의하지 않은 컬렉션은 전부 막는다', async () => {
    await assertFails(setDoc(doc(db(ME), 'random/anything'), { x: 1 }));
  });
});
