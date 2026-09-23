/**
 * 같이 보기 — 표시값 계산과 상태 전이.
 *
 * ── 한 방향으로만 흐른다 ────────────────────────────────────────
 *
 *     내 TODO 원본  →  공유 화면
 *
 * 반대 방향은 없다. 이 모듈에는 `Entry` 를 만들어 돌려주는 함수가 하나도 없고,
 * 공유 화면의 모든 편집은 `SharedTodoItem` 을 돌려준다. 누가 고쳤는지가 아니라
 * **어느 화면에서 고쳤는지**가 기준이므로, 소유자가 공유 화면에서 고쳐도 원본은
 * 그대로다.
 *
 * ── 복제가 아니라 겹쳐 보기다 ───────────────────────────────────
 *
 * 원본을 통째로 복사해 두고 매번 덮어쓰면, 공유 화면에서 고친 값이 다음 갱신에
 * 사라진다. 그래서 두 층으로 나눈다.
 *
 *     source     원본에서 마지막으로 받아 온 값
 *     overrides  공유 화면에서만 고친 값 (키가 있는 필드만)
 *     표시값     = source ⊕ overrides
 *
 * 제목만 고쳐 둔 항목의 원본 날짜가 9/27 로 바뀌면, 공유 화면은 고친 제목과 새 날짜를
 * 함께 보여 준다. 고치지 않은 필드는 계속 원본을 따라간다.
 *
 * ── 고친 값이 원본과 같아지면 override 를 지운다 ────────────────
 *
 * 장식이 아니라 필수다. 편집 화면은 제목·날짜·상태를 **한 번에** 제출하므로, 받은
 * 필드를 전부 override 로 남기면 한 번 편집한 항목이 원본에서 통째로 떨어져 나간다 —
 * "고치지 않은 필드는 원본을 따라간다" 가 그 순간 거짓이 된다.
 */
import { normalizeDate } from './date';
import type {
  DateISO, Entry, SharedOverridableField, SharedOverrides, SharedSource, SharedTodoItem,
} from './types';

export const SHARED_OVERRIDABLE_FIELDS: readonly SharedOverridableField[] = [
  'title', 'note', 'startDate', 'endDate', 'startTime', 'status', 'important', 'urgent',
];

/**
 * 원본이 없는 항목(공유 화면에서만 만든 것)의 바탕값.
 *
 * `startDate` 가 빈 문자열인 것은 자료 결손이 아니라 "날짜 미정" 이다. 오늘 날짜로
 * 메우지 않는다 — 읽기 계층이 시계를 읽으면 어제 만든 항목이 매일 오늘로 옮겨진다.
 */
export const BLANK_SHARED_SOURCE: SharedSource = {
  title: '',
  note: '',
  startDate: '',
  endDate: null,
  startTime: null,
  status: 'planned',
  important: false,
  urgent: false,
  recurring: false,
};

/** 표시값 한 벌 + 어느 필드가 공유 화면에서 고쳐졌는가. */
export interface SharedView extends SharedSource {
  overridden: SharedOverridableField[];
}

/**
 * 공유 대상인가.
 *
 * `kind === 'task'` 만 나간다 — 아이디어와 가계부는 자동 공유하지 않는다.
 * 회복 항목도 뺀다. 그것은 "휴식을 빚지 않게" 관리하는 개인 시스템 항목이고,
 * 캘린더에 올라온 한 건은 규칙이 방금 만든 것이라 상대가 볼 자료가 아니다.
 * 반복 전개분(`virtual`)도 뺀다 — 저장되지 않는 화면용 사본이다.
 *
 * ── 그리고 **지나간 일정은 공유하지 않는다** ────────────────────
 *
 * 같이 보기는 "둘이 앞으로 무엇을 하는가" 를 보는 자리다. 몇 년치 할 일을 통째로
 * 올리면 상대 화면이 지난 기록으로 덮여 이번 주에 무엇이 있는지 볼 수 없다.
 *
 * 경계는 **끝나는 날**이다 — 어제 시작해 모레 끝나는 일정은 아직 진행 중이므로
 * 남는다. 오늘 끝나는 것도 남는다.
 *
 * 반복 항목은 시작일이 아무리 오래됐어도 지금 돌고 있다. 그래서 반복은 `until` 로
 * 판정한다 — 끝이 없으면 계속 공유하고, `until` 이 지났으면 뺀다. (`count` 로 끝나는
 * 반복은 마지막 회차를 알려면 전개해야 하는데, 그 비용을 저장 한 번마다 치를 만한
 * 이득이 없다. 끝난 뒤에도 남아 있을 수 있고, 그 편이 있는 것을 지우는 것보다 낫다.)
 */
export function isShareableTask(e: Entry, todayISO: DateISO): boolean {
  if (e.kind !== 'task' || e.recovery != null || e.virtual === true) return false;
  return !isPastTask(e, todayISO);
}

/** 이 항목이 오늘보다 앞에서 끝났는가. */
export function isPastTask(e: Pick<Entry, 'startDate' | 'endDate' | 'isRecurring' | 'recurrence'>, todayISO: DateISO): boolean {
  const today = normalizeDate(todayISO);
  if (!today) return false;
  if (e.isRecurring || e.recurrence) {
    const until = normalizeDate(e.recurrence?.until);
    return until !== '' && until < today;
  }
  const start = normalizeDate(e.startDate);
  const end = normalizeDate(e.endDate) || start;
  return (end >= start ? end : start) < today;
}

/** 원본에서 공유할 값만 뽑는다. 여기 없는 필드는 상대에게 가지 않는다. */
export function sourceOf(e: Entry): SharedSource {
  return {
    title: e.title,
    note: e.note,
    startDate: normalizeDate(e.startDate),
    endDate: normalizeDate(e.endDate) || null,
    startTime: e.startTime,
    status: e.task?.status ?? 'planned',
    important: e.task?.important ?? false,
    urgent: e.task?.urgent ?? false,
    recurring: e.isRecurring,
  };
}

/** 두 스냅샷이 같은가. 같으면 공유 쪽에 다시 쓸 이유가 없다. */
export function sameSource(a: SharedSource | null, b: SharedSource | null): boolean {
  if (a === null || b === null) return a === b;
  return a.title === b.title
    && a.note === b.note
    && a.startDate === b.startDate
    && a.endDate === b.endDate
    && a.startTime === b.startTime
    && a.status === b.status
    && a.important === b.important
    && a.urgent === b.urgent
    && a.recurring === b.recurring;
}

/** 표시값. `source ⊕ overrides`. */
export function sharedView(item: SharedTodoItem): SharedView {
  const base = item.source ?? BLANK_SHARED_SOURCE;
  const o = item.overrides;
  const pick = <K extends SharedOverridableField>(k: K): SharedSource[K] =>
    (k in o ? (o[k] as SharedSource[K]) : base[k]);
  return {
    title: pick('title'),
    note: pick('note'),
    startDate: pick('startDate'),
    endDate: pick('endDate'),
    startTime: pick('startTime'),
    status: pick('status'),
    important: pick('important'),
    urgent: pick('urgent'),
    // 반복은 원본의 성질이라 고칠 수 없다.
    recurring: base.recurring,
    overridden: overriddenFields(item),
  };
}

export function overriddenFields(item: SharedTodoItem): SharedOverridableField[] {
  return SHARED_OVERRIDABLE_FIELDS.filter((k) => k in item.overrides);
}

/** 공유 화면에서 고친 자리가 있는가. 공유 화면에서만 만든 항목은 '고쳤다' 가 아니다. */
export function isOverridden(item: SharedTodoItem): boolean {
  return !item.localOnly && overriddenFields(item).length > 0;
}

/** '원본대로 되돌리기' 를 줄 수 있는가. 원본이 없는 항목에는 되돌릴 자리가 없다. */
export function canRevert(item: SharedTodoItem): boolean {
  return !item.localOnly && item.source != null && overriddenFields(item).length > 0;
}

function sameValue(a: unknown, b: unknown): boolean {
  return a === b;
}

/**
 * 공유 화면에서 고친다. **`overrides` 만 바뀐다.**
 *
 * 원본과 같아진 필드는 override 에서 **빠진다** — 그 필드는 다시 원본을 따라간다.
 * 원본이 없는 항목(localOnly)은 비교할 대상이 없으므로 받은 값을 그대로 들고 있는다.
 */
export function applyOverrides(item: SharedTodoItem, patch: SharedOverrides, now = new Date().toISOString()): SharedTodoItem {
  const next: SharedOverrides = { ...item.overrides };
  const src = item.localOnly ? null : item.source;
  for (const k of SHARED_OVERRIDABLE_FIELDS) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (v === undefined) continue;
    if (src && sameValue(src[k], v)) delete next[k];
    else Object.assign(next, { [k]: v });
  }
  return { ...item, overrides: next, updatedAt: now };
}

/** 원본대로 되돌린다. **원본은 건드리지 않는다** — override 만 지운다. */
export function revertToSource(item: SharedTodoItem, now = new Date().toISOString()): SharedTodoItem {
  if (!canRevert(item)) return item;
  return { ...item, overrides: {}, updatedAt: now };
}

export function setHidden(item: SharedTodoItem, hidden: boolean, now = new Date().toISOString()): SharedTodoItem {
  return { ...item, hidden, updatedAt: now };
}

/**
 * 원본에서 받은 값으로 공유 항목을 만든다/갱신한다.
 *
 * `overrides` · `hidden` 은 **손대지 않는다.** 실제 저장은 그 두 필드를 아예 보내지
 * 않는 merge 쓰기로 이뤄진다 (`data/sharedRepo.ts`). 여기서는 구독으로 들고 있는
 * 항목에 같은 규칙을 적용해 화면이 서버를 기다리지 않게 한다.
 */
export function withSource(
  item: SharedTodoItem | null, entryId: string, source: SharedSource,
  ownerUid: string, now = new Date().toISOString(),
): SharedTodoItem {
  if (!item) {
    return {
      id: entryId,
      sourceEntryId: entryId,
      source,
      overrides: {},
      localOnly: false,
      hidden: false,
      createdBy: ownerUid,
      createdAt: now,
      updatedAt: now,
    };
  }
  return { ...item, sourceEntryId: entryId, source, updatedAt: now };
}

/**
 * 공유 화면에서만 사는 새 항목.
 *
 * `source` 가 없으므로 값은 전부 `overrides` 에 들어간다 — 그것이 이 항목의 본문이다.
 * 개인 TODO 에는 만들어지지 않는다.
 */
export function newLocalItem(
  id: string, createdBy: string, fields: SharedOverrides, now = new Date().toISOString(),
): SharedTodoItem {
  return {
    id,
    sourceEntryId: null,
    source: null,
    overrides: { title: '', status: 'planned', ...fields },
    localOnly: true,
    hidden: false,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

/** 화면에 보일 제목. 비어 있으면 자리를 비워 두지 않는다. */
export function sharedTitle(item: SharedTodoItem): string {
  return sharedView(item).title.trim() || '(제목 없음)';
}

/**
 * 공유 목록 정렬 키. 날짜 → 시각 → 만든 시각.
 * 날짜가 비어 있는 항목(날짜 미정)은 뒤로 보낸다.
 */
export function sharedSortKey(item: SharedTodoItem): string {
  const v = sharedView(item);
  const date = v.startDate || '9999-99-99';
  return `${date}T${v.startTime ?? '00:00'}#${item.createdAt}`;
}

/**
 * 계정 이름에서 화면에 쓸 짧은 이름.
 *
 * 이메일/비밀번호 로그인만 있으므로 `displayName` 은 대개 비어 있고 값은 이메일이다.
 * 진입점 한 줄에 이메일 전체를 넣으면 줄이 밀리므로 @ 앞만 쓴다. 관계를 값으로
 * 박지 않는다 — 보여 주는 것은 사용자가 실제로 연결한 계정이다.
 */
export function shortName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '상대';
  const at = trimmed.indexOf('@');
  return at > 0 ? trimmed.slice(0, at) : trimmed;
}

/** 보드에서 나 아닌 사람의 이름. 아직 아무도 없으면 null. */
export function partnerName(
  memberUids: readonly string[], memberNames: Record<string, string>, myUid: string,
): string | null {
  const other = memberUids.find((u) => u !== myUid);
  if (!other) return null;
  return shortName(memberNames[other] ?? '');
}

/**
 * 초대 코드.
 *
 * 이 문자열이 곧 문서 id 이고, **그것을 아는 것이 초대장의 전부**다 (규칙이 코드로
 * 초대장을 찾아 확인한다). 그래서 추측할 수 있으면 안 된다 — `Math.random()` 으로
 * 물러나지 않고, 암호학적 난수가 없으면 링크를 만들지 않는다. 20바이트(100비트)를
 * 32진수 한 자에 한 바이트씩 담는다 (256 은 32로 나누어떨어지므로 치우침이 없다).
 */
const CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

export function newInviteCode(): string {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('이 브라우저에서는 초대 링크를 만들 수 없습니다 (암호학적 난수 없음).');
  }
  const bytes = new Uint8Array(20);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % 32] ?? 'a').join('');
}

/** 초대 링크. 앱 주소에 코드를 붙인다 — 별도 페이지를 만들지 않는다. */
export const INVITE_PARAM = 'join';

export function inviteUrl(origin: string, pathname: string, code: string): string {
  return `${origin}${pathname}?${INVITE_PARAM}=${encodeURIComponent(code)}`;
}
