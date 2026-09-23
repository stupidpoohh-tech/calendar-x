/**
 * 같이 보기 — 표시값 계산과 상태 전이.
 *
 * ── 한 방향으로만 흐른다 ────────────────────────────────────────
 *
 *     각자의 TODO 원본  →  공유 화면
 *
 * 반대 방향은 없다. 이 모듈에는 `Entry` 를 만들어 돌려주는 함수가 하나도 없고,
 * 공유 화면의 모든 편집은 `SharedTodoItem` 을 돌려준다. 누가 고쳤는지가 아니라
 * **어느 화면에서 고쳤는지**가 기준이므로, 자기 항목을 공유 화면에서 고쳐도 원본은
 * 그대로다.
 *
 * **둘 다 올린다.** 누가 보드를 만들었는지는 초대와 삭제에만 쓰이고, 올리는 자격과는
 * 무관하다 — 먼저 누른 사람의 TODO 만 보이는 것은 화면에 드러나지 않는 사실이라
 * 설명할 수 없다. 대신 항목마다 **주인**(`createdBy`)이 있고, 맞추기도 권한도 그
 * 값으로 갈린다.
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
import { DEFAULT_COLOR } from './constants';
import { normalizeDate } from './date';
import type {
  DateISO, Entry, SharedCollection, SharedCollectionItem, SharedNote,
  SharedOverridableField, SharedOverrides, SharedSource, SharedTodoItem,
} from './types';

export const SHARED_OVERRIDABLE_FIELDS: readonly SharedOverridableField[] = [
  'title', 'note', 'color', 'startDate', 'endDate', 'startTime', 'status', 'important', 'urgent',
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
  color: DEFAULT_COLOR,
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
 * 사용자가 **비공개로 표시한 항목**(`keepPrivate`)도 뺀다.
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
  // 비공개로 표시한 항목은 올리지 않는다. 이미 올라가 있으면 맞추기가 내린다.
  if (e.keepPrivate === true) return false;
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
    color: e.color,
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
    && a.color === b.color
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
    color: pick('color'),
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
export function applyOverrides(
  item: SharedTodoItem, patch: SharedOverrides, by: string, now = new Date().toISOString(),
): SharedTodoItem {
  const next: SharedOverrides = { ...item.overrides };
  const src = item.localOnly ? null : item.source;
  for (const k of SHARED_OVERRIDABLE_FIELDS) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (v === undefined) continue;
    if (src && sameValue(src[k], v)) delete next[k];
    else Object.assign(next, { [k]: v });
  }
  // 고친 자리가 하나도 안 남았으면 고친 사람도 남기지 않는다.
  const overriddenBy = Object.keys(next).length > 0 ? by : '';
  return { ...item, overrides: next, overriddenBy, updatedAt: now };
}

/** 원본대로 되돌린다. **원본은 건드리지 않는다** — override 만 지운다. */
export function revertToSource(item: SharedTodoItem, now = new Date().toISOString()): SharedTodoItem {
  if (!canRevert(item)) return item;
  return { ...item, overrides: {}, overriddenBy: '', updatedAt: now };
}

/** 이 사람에게 감춰져 있는가. 감추기는 보드 전체가 아니라 사람별이다. */
export function isHiddenFor(item: SharedTodoItem, uid: string): boolean {
  return item.hiddenBy.includes(uid);
}

/**
 * 나에게만 감춘다 / 다시 보이게 한다.
 *
 * **남의 uid 는 건드리지 않는다.** 보드 값 하나로 두면 내가 감춘 순간 상대의 자기
 * 할 일이 상대 화면에서도 사라진다. 규칙도 같은 것을 막는다.
 */
export function setHiddenFor(
  item: SharedTodoItem, uid: string, hidden: boolean, now = new Date().toISOString(),
): SharedTodoItem {
  const has = item.hiddenBy.includes(uid);
  if (has === hidden) return item;
  const hiddenBy = hidden ? [...item.hiddenBy, uid] : item.hiddenBy.filter((u) => u !== uid);
  return { ...item, hiddenBy, updatedAt: now };
}

/** 이 항목을 맞추고 지울 책임이 누구에게 있는가. */
export function ownsMirror(item: SharedTodoItem, uid: string): boolean {
  return item.createdBy === uid;
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
      overriddenBy: '',
      localOnly: false,
      hiddenBy: [],
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
    overriddenBy: '',
    localOnly: true,
    hiddenBy: [],
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

// ---------- 일정 목록 ----------

/**
 * 일정 목록을 **해야 할 것 / 완료** 두 덩이로 나눈다.
 *
 * 상태를 더 잘게 쪼개지 않는다. 둘이 함께 보는 목록에서 '진행중' 은 각자의 머릿속에만
 * 있는 값이라 누가 언제 옮겨 두는지가 불분명해진다 (개인 TODO 의 상태는 그대로 온다 —
 * 여기서 두 덩이로 묶어 보여 줄 뿐이다).
 *
 * 날짜가 없는 항목은 뒤로 보내되 **빼지 않는다** (`sharedSortKey`).
 */
export function scheduleGroups(items: readonly SharedTodoItem[]): {
  todo: SharedTodoItem[];
  done: SharedTodoItem[];
} {
  const sorted = [...items].sort((a, b) => sharedSortKey(a).localeCompare(sharedSortKey(b)));
  const todo: SharedTodoItem[] = [];
  const done: SharedTodoItem[] = [];
  for (const i of sorted) (sharedView(i).status === 'done' ? done : todo).push(i);
  return { todo, done };
}

// ---------- 함께 할 것 ----------

export function newCollection(
  id: string, createdBy: string, title: string, order: number, now = new Date().toISOString(),
): SharedCollection {
  return { id, title: title.trim(), order, createdBy, createdAt: now, updatedAt: now };
}

export function newCollectionItem(
  id: string, collectionId: string, createdBy: string, title: string, order: number,
  now = new Date().toISOString(),
): SharedCollectionItem {
  return {
    id, collectionId, title: title.trim(), completed: false, completedAt: null,
    order, createdBy, createdAt: now, updatedAt: now,
  };
}

/** 완료를 켜고 끈다. 되돌리면 완료 시각도 지운다 — 남겨 두면 거짓이 된다. */
export function toggleCollectionItem(
  item: SharedCollectionItem, now = new Date().toISOString(),
): SharedCollectionItem {
  const completed = !item.completed;
  return { ...item, completed, completedAt: completed ? now : null, updatedAt: now };
}

/** 목록 하나의 진행. `1/3` 으로 적는다. */
export function collectionProgress(
  items: readonly SharedCollectionItem[], collectionId: string,
): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const i of items) {
    if (i.collectionId !== collectionId) continue;
    total += 1;
    if (i.completed) done += 1;
  }
  return { done, total };
}

/** 한 목록의 항목. 완료는 뒤로 보낸다 — 남은 것이 위에 있어야 목록으로 쓸 수 있다. */
export function itemsOfCollection(
  items: readonly SharedCollectionItem[], collectionId: string,
): SharedCollectionItem[] {
  return items
    .filter((i) => i.collectionId === collectionId)
    .sort((a, b) =>
      Number(a.completed) - Number(b.completed)
      || a.order - b.order
      || a.createdAt.localeCompare(b.createdAt));
}

/**
 * 함께 할 것 → 공유 일정.
 *
 * 날짜 없이 만든다. "언젠가" 를 "언제" 로 바꾸는 것은 사람이 정하는 일이고, 오늘로
 * 메우면 오늘 해야 하는 일처럼 보인다.
 *
 * **원래 항목은 완료하지 않는다.** 일정으로 옮긴 것은 아직 한 것이 아니다 — 실제로
 * 다녀오거나 해 본 뒤에 완료한다.
 */
export function scheduleFromCollectionItem(
  id: string, item: SharedCollectionItem, createdBy: string, now = new Date().toISOString(),
): SharedTodoItem {
  return newLocalItem(id, createdBy, { title: item.title.trim(), status: 'planned' }, now);
}

// ---------- 메모 ----------

export function newNote(
  id: string, authorUid: string, title: string, body: string, now = new Date().toISOString(),
): SharedNote {
  const t = title.trim();
  return { id, title: t || null, body, pinned: false, authorUid, createdAt: now, updatedAt: now };
}

/** 화면에 적을 제목. 없으면 본문 첫 줄을 쓴다 — 제목 없는 카드를 만들지 않는다. */
export function noteTitle(note: SharedNote): string {
  const t = (note.title ?? '').trim();
  if (t) return t;
  const firstLine = note.body.split('\n').find((l) => l.trim()) ?? '';
  return firstLine.trim().slice(0, 60) || '(빈 메모)';
}

/** 보드 위 한 줄에 적을 요약. 줄바꿈은 가운뎃점으로 바꾼다. */
export function noteSummary(note: SharedNote, max = 60): string {
  const flat = note.body.split('\n').map((l) => l.trim()).filter(Boolean).join(' · ');
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** 고정된 글. 여럿이면 가장 최근에 고친 것 하나만 쓴다. */
export function pinnedNote(notes: readonly SharedNote[]): SharedNote | null {
  const pinned = notes.filter((n) => n.pinned);
  if (pinned.length === 0) return null;
  return [...pinned].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

/** 고정글 먼저, 그 다음은 최신 순. */
export function sortNotes(notes: readonly SharedNote[]): SharedNote[] {
  return [...notes].sort((a, b) =>
    Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
}

/**
 * 고정을 옮긴다. **살아 있는 고정은 하나다.**
 *
 * 돌려주는 것은 "바뀐 글들" 이다 — 새로 고정할 글과, 고정이 풀리는 글들. 부르는 쪽이
 * 그만큼만 저장한다. 여럿을 고정할 수 있게 하면 보드 위 한 줄에 무엇을 적을지가
 * 매번 애매해진다.
 */
export function repinNotes(
  notes: readonly SharedNote[], targetId: string, pinned: boolean,
  now = new Date().toISOString(),
): SharedNote[] {
  const out: SharedNote[] = [];
  for (const n of notes) {
    if (n.id === targetId) {
      if (n.pinned !== pinned) out.push({ ...n, pinned, updatedAt: now });
    } else if (pinned && n.pinned) {
      out.push({ ...n, pinned: false, updatedAt: now });
    }
  }
  return out;
}
