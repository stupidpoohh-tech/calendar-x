/**
 * 반복 일정 전개. (F-04)
 *
 * 이전 코드는 repeat 값을 저장만 하고 어디에서도 읽지 않았다. 사용자에게는 동작하는
 * 기능처럼 보였지만 반복 항목은 첫 날짜에만 나타났다. 여기서는 조회 범위에 걸치는
 * 발생분만 가상 항목으로 펼쳐서 캘린더·리스트에 넘긴다. 펼친 항목은 저장하지 않는다.
 */
import { MAX_RECURRENCE_OCCURRENCES } from './constants';
import { addDaysISO, addMonthsISO, daysBetween, normalizeDate, ymRange } from './date';
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
 * [from, to] 구간에 보이는 발생분을 만든다.
 * 구간 앞에서 시작해 구간 안으로 이어지는 기간형 항목도 포함한다.
 */
export function expandEntry(entry: Entry, from: DateISO, to: DateISO): Entry[] {
  const r = entry.recurrence;
  if (!r) return [];

  const start = normalizeDate(entry.startDate);
  if (!start) return [];

  const durationDays = Math.max(0, daysBetween(start, effectiveEndDate(entry)));
  const until = r.until ? normalizeDate(r.until) : null;
  const limit = r.count != null && r.count > 0
    ? Math.min(r.count, MAX_RECURRENCE_OCCURRENCES)
    : MAX_RECURRENCE_OCCURRENCES;

  const out: Entry[] = [];
  for (let n = 0; n < limit; n++) {
    const occStart = advance(start, r, n);
    if (until && occStart > until) break;
    if (occStart > to) break;

    const occEnd = durationDays > 0 ? addDaysISO(occStart, durationDays) : occStart;
    if (occEnd < from) continue;

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
