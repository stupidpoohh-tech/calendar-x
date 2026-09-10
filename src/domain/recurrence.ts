/**
 * 반복 일정 전개. (F-04)
 *
 * 이전 코드는 repeat 값을 저장만 하고 어디에서도 읽지 않았다. 사용자에게는 동작하는
 * 기능처럼 보였지만 반복 항목은 첫 날짜에만 나타났다. 여기서는 조회 범위에 걸치는
 * 발생분만 가상 항목으로 펼쳐서 캘린더·리스트에 넘긴다. 펼친 항목은 저장하지 않는다.
 */
import { MAX_RECURRENCE_OCCURRENCES } from './constants';
import { addDaysISO, addMonthsISO, daysBetween, normalizeDate, parseDate, ymRange } from './date';
import { effectiveEndDate } from './entry';
import type { DateISO, Entry, Recurrence } from './types';

const OCCURRENCE_SEP = '@';

export function occurrenceId(baseId: string, date: DateISO): string {
  return `${baseId}${OCCURRENCE_SEP}${date}`;
}

export function isOccurrenceId(id: string): boolean {
  return id.includes(OCCURRENCE_SEP);
}

/** 가상 발생분의 id 에서 원본 항목 id 를 되찾는다. 편집·삭제는 항상 원본을 향한다. */
/**
 * 화면용으로 펼친 가상 발생분인가.
 *
 * id 모양(`원본id@날짜`)이 아니라 `virtual` 표식으로 판정한다. id 는 백업 파일에서
 * 들어올 수 있어 사용자가 '@' 가 든 id 를 만들 수 있지만, `virtual` 은 저장 경로에
 * 아예 없어서 `expandEntry()` 말고는 켤 방법이 없다.
 */
export function isVirtualEntry(entry: Pick<Entry, 'virtual'>): boolean {
  return entry.virtual === true;
}

export function baseIdOf(id: string): string {
  const i = id.indexOf(OCCURRENCE_SEP);
  return i === -1 ? id : id.slice(0, i);
}

export function occurrenceDateOf(id: string): DateISO | null {
  const i = id.indexOf(OCCURRENCE_SEP);
  return i === -1 ? null : id.slice(i + 1);
}

function advance(start: DateISO, r: Recurrence, n: number): DateISO {
  const step = Math.max(1, Math.trunc(r.interval)) * n;
  switch (r.freq) {
    case 'daily':   return addDaysISO(start, step);
    case 'weekly':  return addDaysISO(start, step * 7);
    case 'monthly': return addMonthsISO(start, step);
  }
}

/**
 * `advance(start, r, n) >= target` 인 가장 작은 n.
 *
 * 원점부터 한 칸씩 세면, 2025-01-01 에 시작한 매일 반복을 2026-09 월에서 볼 때
 * 600 칸이 넘게 헛돈다. 예전에는 그 헛도는 칸을 상한(400)이 먼저 잘라서 오래된
 * 무기한 반복이 캘린더에서 통째로 사라졌다. 상한을 올리는 대신 조회 범위 근처로
 * 건너뛴다 — 상한은 화면에 낼 개수의 상한으로만 남는다.
 *
 * 어림값을 낸 뒤 한두 칸 보정한다. 달 반복은 말일 당김(1/31 → 2/28) 때문에
 * 어림값이 정확히 맞지 않을 수 있어서다.
 */
function firstIndexOnOrAfter(start: DateISO, r: Recurrence, target: DateISO): number {
  if (target <= start) return 0;

  const step = Math.max(1, Math.trunc(r.interval));
  let n: number;
  if (r.freq === 'monthly') {
    const a = parseDate(start);
    const t = parseDate(target);
    if (!a || !t) return 0;
    const months = (t.getFullYear() - a.getFullYear()) * 12 + (t.getMonth() - a.getMonth());
    n = Math.floor(months / step);
  } else {
    const stepDays = r.freq === 'weekly' ? step * 7 : step;
    n = Math.floor(daysBetween(start, target) / stepDays);
  }
  if (!Number.isFinite(n) || n < 0) n = 0;

  // 보정은 몇 칸이면 끝난다. 그래도 깨진 값에 붙들리지 않게 상한을 둔다.
  let guard = 0;
  while (n > 0 && advance(start, r, n - 1) >= target && guard++ < 64) n--;
  guard = 0;
  while (advance(start, r, n) < target && guard++ < 64) n++;
  return n;
}

/**
 * [from, to] 구간에 보이는 발생분을 만든다.
 * 구간 앞에서 시작해 구간 안으로 이어지는 기간형 항목도 포함한다.
 */
export function expandEntry(entry: Entry, from: DateISO, to: DateISO): Entry[] {
  const r = entry.recurrence;
  if (!r) return [];

  const start = normalizeDate(entry.startDate);
  if (!start) return [];

  const fromN = normalizeDate(from);
  const toN = normalizeDate(to);
  if (!fromN || !toN || fromN > toN) return [];

  const durationDays = Math.max(0, daysBetween(start, effectiveEndDate(entry)));
  const until = r.until ? normalizeDate(r.until) : null;
  // `count` 는 원점부터 세는 값이다. 건너뛰어도 이 상한은 원점 기준 그대로 지킨다.
  const count = r.count != null && r.count > 0 ? Math.trunc(r.count) : null;

  // 구간 앞에서 시작해 구간 안으로 이어지는 기간형 항목도 봐야 한다.
  const reach = durationDays > 0 ? addDaysISO(fromN, -durationDays) : fromN;
  const first = firstIndexOnOrAfter(start, r, reach);

  const out: Entry[] = [];
  for (let n = first; count == null || n < count; n++) {
    // 상한은 이제 "화면에 낼 개수" 의 상한이다. 원점에서 몇 번째인지와 무관하다.
    if (out.length >= MAX_RECURRENCE_OCCURRENCES) break;

    const occStart = advance(start, r, n);
    if (until && occStart > until) break;
    if (occStart > toN) break;

    const occEnd = durationDays > 0 ? addDaysISO(occStart, durationDays) : occStart;
    if (occEnd < fromN) continue;

    out.push({
      ...entry,
      id: occurrenceId(entry.id, occStart),
      startDate: occStart,
      endDate: durationDays > 0 ? occEnd : null,
      ymSpan: ymRange(occStart, occEnd),
      // 화면용 사본이라는 표식. 금액 계산은 이 값을 보고 거절한다.
      virtual: true,
    });
  }
  return out;
}

/**
 * 조회 결과를 화면에 올릴 형태로 정리한다.
 * 반복 항목은 원본을 빼고 전개분으로 대체하므로, 원본이 첫 발생일에 중복 표시되지 않는다.
 */
export function materialize(entries: readonly Entry[], from: DateISO, to: DateISO): Entry[] {
  const out: Entry[] = [];
  for (const e of entries) {
    if (e.isRecurring && e.recurrence) {
      out.push(...expandEntry(e, from, to));
    } else {
      out.push(e);
    }
  }
  return out;
}

export function describeRecurrence(r: Recurrence | null): string {
  if (!r) return '반복 없음';
  const every = r.interval > 1 ? `${r.interval}` : '';
  const unit = r.freq === 'daily' ? '일' : r.freq === 'weekly' ? '주' : '개월';
  const head = every ? `${every}${unit}마다` : r.freq === 'daily' ? '매일' : r.freq === 'weekly' ? '매주' : '매월';
  if (r.until) return `${head} · ${r.until}까지`;
  if (r.count != null) return `${head} · ${r.count}회`;
  return head;
}
