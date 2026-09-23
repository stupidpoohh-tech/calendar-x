/**
 * 공유 보드 문서 ↔ 도메인.
 *
 * 읽기는 개인 자료와 같은 원칙으로 방어적이다. 다만 한 가지가 다르다 —
 * **이 문서는 상대도 쓴다.** 그래서 "모르는 값이면 기본값" 이 더 위험한 자리가 있다.
 *
 * ── 모르는 override 는 기본값으로 바꾸지 않고 버린다 ────────────
 *
 * `overrides.status` 가 알 수 없는 값이면 'planned' 로 떨어뜨리지 않는다. 그렇게 하면
 * 끝낸 일이 되살아난다. 키를 **버리면** 그 필드는 다시 원본을 따라가므로, 최소한
 * 원본이 말하는 사실은 유지된다.
 *
 * ── 갱신 쓰기는 `overrides` · `hidden` 을 보내지 않는다 ─────────
 *
 * 원본 → 공유 갱신(`sharedSourcePatch`)은 `source` 계열 필드만 담는다. merge 로 쓰면
 * 담지 않은 필드는 그대로 남으므로, 상대가 고쳐 둔 값도 감춰 둔 상태도 살아남는다.
 * 그래서 이 파일의 읽기 쪽은 **세 필드가 아예 없는 문서**를 정상으로 다뤄야 한다 —
 * 없으면 `{}` · false 다.
 */
import { COLOR_BY_ID, DEFAULT_COLOR, STATUS_BY_ID } from '../domain/constants';
import { normalizeDate } from '../domain/date';
import { BLANK_SHARED_SOURCE, SHARED_OVERRIDABLE_FIELDS } from '../domain/shared';
import type {
  ColorId, SharedBoard, SharedDday, SharedInvite, SharedOverrides, SharedPin,
  SharedSource, SharedTodoItem, TaskStatus,
} from '../domain/types';

type Raw = Record<string, unknown>;

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);
const obj = (v: unknown): Raw | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null);
const strArr = (v: unknown): string[] =>
  (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

const asStatus = (v: unknown): TaskStatus | null =>
  (typeof v === 'string' && v in STATUS_BY_ID ? (v as TaskStatus) : null);

/** 모르는 색은 null 이다. 부르는 쪽이 기본색으로 떨어뜨릴지 키를 버릴지 정한다. */
const asColor = (v: unknown): ColorId | null =>
  (typeof v === 'string' && v in COLOR_BY_ID ? (v as ColorId) : null);

const asTime = (v: unknown): string | null =>
  (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null);

/** 이름 맵. 값이 문자열인 항목만 남긴다. */
function nameMap(v: unknown): Record<string, string> {
  const raw = obj(v);
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const [k, value] of Object.entries(raw)) {
    if (typeof value === 'string') out[k] = value.slice(0, 120);
  }
  return out;
}

// ---------- 보드 ----------

export function sharedBoardFromDoc(id: string, raw: Raw): SharedBoard {
  const ownerUid = str(raw.ownerUid);
  const members = strArr(raw.memberUids);
  return {
    id,
    ownerUid,
    // 소유자가 목록에서 빠지면 자기 보드를 못 읽는다. 읽기 쪽에서 메워 둔다.
    memberUids: ownerUid && !members.includes(ownerUid) ? [ownerUid, ...members] : members,
    memberNames: nameMap(raw.memberNames),
    name: str(raw.name, '같이 보기'),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

export function sharedBoardToDoc(b: SharedBoard): Raw {
  return {
    ownerUid: b.ownerUid,
    memberUids: b.memberUids,
    memberNames: b.memberNames,
    name: b.name,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

export function sharedInviteFromDoc(code: string, raw: Raw): SharedInvite {
  return {
    code,
    boardId: str(raw.boardId),
    ownerUid: str(raw.ownerUid),
    boardName: str(raw.boardName, '같이 보기'),
    createdAt: str(raw.createdAt),
  };
}

export function sharedInviteToDoc(i: SharedInvite): Raw {
  return {
    boardId: i.boardId,
    ownerUid: i.ownerUid,
    boardName: i.boardName,
    createdAt: i.createdAt,
  };
}

// ---------- 항목 ----------

function sourceFromRaw(v: unknown): SharedSource | null {
  const r = obj(v);
  if (!r) return null;
  const startDate = normalizeDate(str(r.startDate));
  const endRaw = normalizeDate(str(r.endDate));
  return {
    title: str(r.title),
    note: str(r.note),
    // 모르는 색은 기본색으로 떨어뜨린다. 뜻이 바뀌는 값이 아니라 보이는 값이라,
    // 거절하면 항목 전체가 안 보이는 쪽이 더 나쁘다.
    color: asColor(r.color) ?? DEFAULT_COLOR,
    startDate,
    // 뒤집힌 기간은 기간이 아니다. 원본 읽기(`entryFromDoc`)와 같은 규칙으로 접는다.
    endDate: endRaw && startDate && endRaw >= startDate ? endRaw : null,
    startTime: asTime(r.startTime),
    status: asStatus(r.status) ?? BLANK_SHARED_SOURCE.status,
    important: bool(r.important),
    urgent: bool(r.urgent),
    recurring: bool(r.recurring),
  };
}

/**
 * override 맵.
 *
 * 값의 형태가 맞지 않으면 **그 키를 버린다.** 기본값으로 바꾸면 원본이 말하는 사실까지
 * 덮어써서, 끝낸 일이 예정으로 되살아나거나 고치지 않은 날짜가 바뀐다.
 */
function overridesFromRaw(v: unknown): SharedOverrides {
  const r = obj(v);
  if (!r) return {};
  const out: SharedOverrides = {};
  for (const k of SHARED_OVERRIDABLE_FIELDS) {
    if (!(k in r)) continue;
    const value = r[k];
    switch (k) {
      case 'title':
        if (typeof value === 'string') out.title = value;
        break;
      case 'note':
        if (typeof value === 'string') out.note = value;
        break;
      case 'color': {
        // override 는 다르다. 모르는 값이면 키를 버려 원본 색을 따라가게 둔다.
        const c = asColor(value);
        if (c) out.color = c;
        break;
      }
      case 'startDate': {
        const d = normalizeDate(typeof value === 'string' ? value : '');
        if (d) out.startDate = d;
        break;
      }
      case 'endDate': {
        // null 은 "기간 없음으로 고쳤다" 는 뜻이다. 키를 버리면 원본 기간이 되살아난다.
        if (value === null) out.endDate = null;
        else {
          const d = normalizeDate(typeof value === 'string' ? value : '');
          if (d) out.endDate = d;
        }
        break;
      }
      case 'startTime': {
        if (value === null) out.startTime = null;
        else {
          const t = asTime(value);
          if (t) out.startTime = t;
        }
        break;
      }
      case 'status': {
        const s = asStatus(value);
        if (s) out.status = s;
        break;
      }
      case 'important':
        if (typeof value === 'boolean') out.important = value;
        break;
      case 'urgent':
        if (typeof value === 'boolean') out.urgent = value;
        break;
    }
  }
  return out;
}

export function sharedItemFromDoc(id: string, raw: Raw): SharedTodoItem {
  const source = sourceFromRaw(raw.source);
  const sourceEntryId = typeof raw.sourceEntryId === 'string' && raw.sourceEntryId ? raw.sourceEntryId : null;
  return {
    id,
    sourceEntryId,
    source,
    // 세 필드는 갱신 쓰기가 담지 않는다. 없는 것이 정상이다.
    overrides: overridesFromRaw(raw.overrides),
    localOnly: bool(raw.localOnly, sourceEntryId === null && source === null),
    hidden: bool(raw.hidden),
    createdBy: str(raw.createdBy),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

function sourceToDoc(s: SharedSource): Raw {
  return {
    title: s.title,
    note: s.note,
    color: s.color,
    startDate: s.startDate,
    endDate: s.endDate,
    startTime: s.startTime,
    status: s.status,
    important: s.important,
    urgent: s.urgent,
    recurring: s.recurring,
  };
}

/** 항목 전체 쓰기. 공유 화면의 편집과 공유 전용 항목 생성이 쓴다. */
export function sharedItemToDoc(item: SharedTodoItem): Raw {
  return {
    sourceEntryId: item.sourceEntryId,
    source: item.source ? sourceToDoc(item.source) : null,
    overrides: { ...item.overrides },
    localOnly: item.localOnly,
    hidden: item.hidden,
    createdBy: item.createdBy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/**
 * 원본 → 공유 갱신에 쓰는 **부분 문서**.
 *
 * `overrides` · `hidden` · `localOnly` 가 **없다.** merge 로 쓰면 담지 않은 필드는
 * 그대로 남으므로, 상대가 고쳐 둔 값과 감춰 둔 상태를 덮지 않는다. 문서가 아직 없으면
 * 이 필드들만 있는 문서가 만들어지고, 읽기 쪽이 `{}` · false 로 메운다.
 */
export function sharedSourcePatch(entryId: string, source: SharedSource, ownerUid: string, now: string): Raw {
  return {
    sourceEntryId: entryId,
    source: sourceToDoc(source),
    localOnly: false,
    createdBy: ownerUid,
    updatedAt: now,
  };
}

// ---------- 고정메모 · D-Day ----------

export function sharedPinFromDoc(id: string, raw: Raw): SharedPin {
  return {
    id,
    text: str(raw.text),
    order: num(raw.order, 0),
    createdBy: str(raw.createdBy),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

export function sharedPinToDoc(p: SharedPin): Raw {
  return {
    text: p.text, order: p.order,
    createdBy: p.createdBy, createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

export function sharedDdayFromDoc(id: string, raw: Raw): SharedDday {
  return {
    id,
    title: str(raw.title),
    // 날짜가 깨져 있으면 빈 값으로 둔다. 오늘로 메우면 D-Day 가 매일 오늘이 된다.
    date: normalizeDate(str(raw.date)),
    order: num(raw.order, 0),
    createdBy: str(raw.createdBy),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

export function sharedDdayToDoc(d: SharedDday): Raw {
  return {
    title: d.title, date: d.date, order: d.order,
    createdBy: d.createdBy, createdAt: d.createdAt, updatedAt: d.updatedAt,
  };
}
