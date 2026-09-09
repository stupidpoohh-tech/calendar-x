/**
 * 회복(Recovery) 규칙.
 *
 * 핵심 문장: **휴식을 기록하는 기능이 아니라, 휴식을 빚지 않게 관리하는 기능.**
 * 그래서 이 파일에는 피로도도, 점수도, 활동량도 없다. 있는 것은 두 개뿐이다.
 *
 *   1. 간격 — 마지막으로 실제로 쉰 날 + n일
 *   2. 빚   — 놓친 횟수 (시간이 아니라 횟수)
 *
 * ## 왜 `recurrence` 를 쓰지 않는가
 *
 * 반복 일정은 시작일에서 규칙대로 펼치므로 몇 달치가 한 번에 생긴다. 회복은 그렇게
 * 굴러가지 않는다 — 다음 날짜가 "마지막으로 실제로 완료한 날" 에 매달려 있어서,
 * 완료하기 전에는 그다음 날짜를 알 수가 없다. 그래서 예정일은 규칙에 값 하나로 두고,
 * 코앞(`generationHorizonDays`)에 왔을 때만 실제 항목 한 건을 만든다.
 *
 * ## 상태 기계
 *
 *   nextDueAt 있음 · activeEntryId 없음   →  기다리는 중 (캘린더에 아무것도 없다)
 *   지평선 진입                            →  Event 1건 생성 (activeEntryId 채움)
 *     ├ 완료   →  debt 0 이면 완료일 + 간격으로 새 예정. 아니면 예정 없음
 *     ├ 옮기기 →  예정일만 바뀐다. 빚은 늘지 않는다
 *     └ 건너뜀 →  빚 +1, 예정 없음
 *   빚 > 0 · 예정 없음                     →  "다시 잡기" 만이 다음 회차를 만든다
 *
 * 빚이 남아 있는 동안 간격이 저절로 돌지 않는 것이 의도다. 놓친 회복을 갚기 전에
 * 다음 회복이 또 쌓이면, 빚은 사용자가 손댈 수 없는 숫자가 된다.
 */
import { addDaysISO, normalizeDate } from './date';
import { newEntry, uid, withDerived } from './entry';
import type {
  DateISO, Entry, RecoveryFields, RecoveryOption, RecoveryOptionSnapshot,
  RecoveryRule, RecoveryWindowId, TimeHM,
} from './types';

/** 캘린더에 뜨는 제목. 무엇을 끄는 시간인지가 제목에 다 들어 있어야 한다. */
export const RECOVERY_TITLE = 'Recovery — OUTPUT OFF';

/** 회복 항목의 색. 할 일들 사이에서 한눈에 갈리되 경고색은 아니어야 한다. */
export const RECOVERY_COLOR = 'cyan' as const;

export interface RecoveryWindowDef {
  id: RecoveryWindowId;
  label: string;
  startTime: TimeHM | null;
  endTime: TimeHM | null;
}

export const RECOVERY_WINDOWS: readonly RecoveryWindowDef[] = [
  { id: 'evening',   label: '저녁 OFF',     startTime: '18:00', endTime: '23:59' },
  { id: 'afternoon', label: '오후부터 OFF', startTime: '13:00', endTime: '23:59' },
  { id: 'day',       label: '하루 OFF',     startTime: null,    endTime: null },
];

export function recoveryWindow(id: RecoveryWindowId): RecoveryWindowDef {
  return RECOVERY_WINDOWS.find((w) => w.id === id) ?? RECOVERY_WINDOWS[0]!;
}

/**
 * 기본 OFF 옵션.
 *
 * 이것은 활동량 기록이 아니다. "이 회복 동안 무엇을 꺼 둘 것인가" 를 적어 두는
 * 목록일 뿐이고, 그래서 매 회차 새로 고르라고 묻지 않는다 — Rule 기본값이 그대로 복사된다.
 */
export const DEFAULT_RECOVERY_OPTIONS: readonly RecoveryOption[] = [
  { id: 'personal', label: '개인 프로젝트', order: 0 },
  { id: 'work',     label: '회사 일',       order: 1 },
  { id: 'ai',       label: 'AI 작업',       order: 2 },
  { id: 'output',   label: '새 산출물',     order: 3 },
];

export const RECOVERY_INTERVAL_CHOICES: readonly number[] = [2, 3, 4, 5, 7, 10, 14];
export const RECOVERY_HORIZON_CHOICES: readonly number[] = [0, 1, 2, 3];

export function horizonLabel(days: number): string {
  return days === 0 ? '당일' : `${days}일 전`;
}

export function defaultRecoveryRule(): RecoveryRule {
  return {
    enabled: false,
    intervalDays: 3,
    window: 'evening',
    generationHorizonDays: 1,
    lastCompletedAt: null,
    nextDueAt: null,
    activeEntryId: null,
    debtCount: 0,
    defaultMemo: '',
    defaultOptionIds: DEFAULT_RECOVERY_OPTIONS.map((o) => o.id),
    options: DEFAULT_RECOVERY_OPTIONS.map((o) => ({ ...o })),
  };
}

export function isRecoveryEntry(e: Pick<Entry, 'recovery'>): boolean {
  return e.recovery != null;
}

/** 마지막 완료일에서 다음 예정일. 간격은 최소 하루다. */
export function nextDueFrom(from: DateISO, intervalDays: number): DateISO {
  return addDaysISO(normalizeDate(from), Math.max(1, Math.trunc(intervalDays)));
}

/** 이 예정일의 Event 를 만들기 시작하는 날. */
export function generationDateOf(rule: RecoveryRule): DateISO | null {
  if (!rule.nextDueAt) return null;
  return addDaysISO(rule.nextDueAt, -Math.max(0, Math.trunc(rule.generationHorizonDays)));
}

/**
 * 예정이 비어 있으면 채운다.
 *
 * 오래 꺼 두었다가 다시 켠 경우 `lastCompletedAt + 간격` 이 한참 과거일 수 있다.
 * 그 과거를 그대로 쓰면 켜자마자 밀린 회복처럼 보이므로 오늘로 당긴다 —
 * 켜 두지 않은 기간은 빚이 아니다.
 */
export function primeRule(rule: RecoveryRule, todayISO: DateISO): RecoveryRule {
  if (!rule.enabled) return rule;
  if (rule.nextDueAt || rule.debtCount > 0) return rule;
  const raw = nextDueFrom(rule.lastCompletedAt ?? todayISO, rule.intervalDays);
  return { ...rule, nextDueAt: raw < todayISO ? todayISO : raw };
}

/** 오늘 실제 Event 를 만들어야 하는가. */
export function shouldGenerate(rule: RecoveryRule, todayISO: DateISO): boolean {
  if (!rule.enabled) return false;
  // 캘린더에는 언제나 가까운 회복 한 건만 있다.
  if (rule.activeEntryId) return false;
  const from = generationDateOf(rule);
  if (!from) return false;
  return normalizeDate(todayISO) >= from;
}

/** Rule 기본 옵션을 이 회차의 스냅샷으로 굳힌다. */
export function snapshotOptions(rule: RecoveryRule): RecoveryOptionSnapshot[] {
  const byId = new Map(rule.options.map((o) => [o.id, o]));
  return rule.defaultOptionIds
    .map((id) => byId.get(id))
    .filter((o): o is RecoveryOption => o != null)
    .sort((a, b) => a.order - b.order)
    .map((o) => ({ id: o.id, label: o.label }));
}

export interface BuildOptions {
  /** 밀린 회복을 갚는 회차인가. */
  repayment?: boolean;
  /** 시각을 직접 지정한다. 주지 않으면 회복 단위가 정한다. */
  startTime?: TimeHM | null;
  /** 테스트에서 id 를 고정하기 위한 통로. */
  id?: string;
}

export function buildRecoveryEntry(
  rule: RecoveryRule, dueDate: DateISO, opts: BuildOptions = {},
): Entry {
  const w = recoveryWindow(rule.window);
  const fields: RecoveryFields = {
    options: snapshotOptions(rule),
    repayment: opts.repayment ?? false,
    movedCount: 0,
  };
  return newEntry('task', {
    id: opts.id ?? uid(),
    title: RECOVERY_TITLE,
    // Rule 기본 메모는 여기서 한 번 복사된다. 이후 회차에서 메모를 고쳐도
    // 이 값은 Rule 로 돌아가지 않는다.
    note: rule.defaultMemo,
    color: RECOVERY_COLOR,
    startDate: normalizeDate(dueDate),
    startTime: opts.startTime !== undefined ? opts.startTime : w.startTime,
    endTime: w.endTime,
    task: { status: 'planned', important: false, urgent: false, order: Date.now() },
    recovery: fields,
  });
}

/**
 * 규칙과 항목을 함께 옮긴 결과.
 * `entry` 가 null 이면 그 Event 는 사라진다 (건너뛰기).
 */
export interface RecoveryTransition {
  rule: RecoveryRule;
  entry: Entry | null;
}

/** 지평선에 들어섰으면 Event 한 건을 만든다. 아니면 null. */
export function generateRecovery(rule: RecoveryRule, todayISO: DateISO): RecoveryTransition | null {
  if (!shouldGenerate(rule, todayISO) || !rule.nextDueAt) return null;
  const entry = buildRecoveryEntry(rule, rule.nextDueAt);
  return { rule: { ...rule, activeEntryId: entry.id }, entry };
}

/**
 * 완료.
 *
 * 빚을 갚는 회차였다면 빚이 하나 줄고, 그러고도 빚이 남아 있으면 다음 예정을 잡지 않는다.
 * 남은 빚을 "다시 잡기" 로 갚아 0 이 되는 순간, 그 완료일이 새 간격의 기준점이 된다.
 * 원래의 9/4 · 9/7 · 9/10 열을 복원하지 않는 것이 요점이다 — 목표는 달력을 되살리는 게
 * 아니라 회복 간격을 다시 확보하는 것이다.
 */
export function completeRecovery(
  rule: RecoveryRule, entry: Entry, completedOn: DateISO,
): RecoveryTransition {
  const on = normalizeDate(completedOn);
  const debt = entry.recovery?.repayment
    ? Math.max(0, rule.debtCount - 1)
    : rule.debtCount;
  const task = entry.task ?? { status: 'planned' as const, important: false, urgent: false, order: 0 };
  return {
    rule: {
      ...rule,
      debtCount: debt,
      lastCompletedAt: on,
      nextDueAt: debt === 0 ? nextDueFrom(on, rule.intervalDays) : null,
      activeEntryId: null,
    },
    entry: withDerived({ ...entry, task: { ...task, status: 'done' } }),
  };
}

/**
 * 옮기기.
 *
 * 충돌했을 때의 기본 행동이다. 새 시간이 실제로 잡혀 있으므로 빚이 아니다 —
 * Recovery Scheduled → Move → Recovery Scheduled 로 상태가 유지된다.
 */
export function moveRecovery(
  rule: RecoveryRule, entry: Entry, toDate: DateISO, toTime: TimeHM | null,
): RecoveryTransition {
  const date = normalizeDate(toDate);
  const rec = entry.recovery;
  return {
    rule: { ...rule, nextDueAt: date },
    entry: withDerived({
      ...entry,
      startDate: date,
      startTime: toTime,
      recovery: rec ? { ...rec, movedCount: rec.movedCount + 1 } : rec,
    }),
  };
}

/**
 * 건너뛰기.
 *
 * 삭제와 뜻이 다르다. 이쪽은 빚을 남긴다. 그래서 화면에서는 회복을 없애는 기본 행동이
 * 삭제가 아니라 옮기기·건너뛰기여야 한다 — 지워서 빚이 증발하는 상태를 만들지 않는다.
 * 항목 자체는 지운다. 놓쳤다는 사실은 캘린더의 흔적이 아니라 빚 숫자가 기억한다.
 */
export function skipRecovery(rule: RecoveryRule): RecoveryTransition {
  return {
    rule: { ...rule, debtCount: rule.debtCount + 1, nextDueAt: null, activeEntryId: null },
    entry: null,
  };
}

/** 밀린 회복을 다시 잡는다. Rule 기본 메모와 기본 옵션이 그대로 적용된다. */
export function scheduleDebtRecovery(
  rule: RecoveryRule, dateISO: DateISO, time: TimeHM | null,
): RecoveryTransition {
  const date = normalizeDate(dateISO);
  const entry = buildRecoveryEntry(rule, date, { repayment: true, startTime: time });
  return { rule: { ...rule, nextDueAt: date, activeEntryId: entry.id }, entry };
}

// ---------- 옵션 관리 ----------

/** 화면에 보이는 이름을 정리한다. 저장되는 값이 곧 이 값이다. */
export function normalizeOptionLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, 40);
}

/**
 * 같은 이름의 옵션을 찾는다.
 *
 * 이름은 사용자가 직접 관리하는 목록이라, 같은 것을 두 번 적는 일이 실제로 생긴다
 * ('사우나' 와 '사우나 '). 대소문자와 공백만 무시하고 같은 것으로 본다.
 */
export function findRecoveryOption(rule: RecoveryRule, label: string): RecoveryOption | undefined {
  const key = normalizeOptionLabel(label).toLowerCase();
  if (!key) return undefined;
  return rule.options.find((o) => normalizeOptionLabel(o.label).toLowerCase() === key);
}

/**
 * 옵션 추가.
 *
 * 같은 이름이 이미 있으면 목록을 불리지 않고 그것의 기본 선택만 켠다 —
 * 이 목록은 사용자가 직접 손으로 관리하므로, 중복이 쌓이면 관리 자체가 일이 된다.
 */
export function addRecoveryOption(rule: RecoveryRule, label: string): RecoveryRule {
  const text = normalizeOptionLabel(label);
  if (!text) return rule;

  const existing = findRecoveryOption(rule, text);
  if (existing) {
    return rule.defaultOptionIds.includes(existing.id) ? rule : toggleDefaultOption(rule, existing.id);
  }

  const option: RecoveryOption = {
    id: uid(),
    label: text,
    order: rule.options.reduce((m, o) => Math.max(m, o.order), -1) + 1,
  };
  return {
    ...rule,
    options: [...rule.options, option],
    // 새로 만든 옵션은 켜 둔 채로 시작한다. 만들자마자 한 번 더 켜게 하지 않는다.
    defaultOptionIds: [...rule.defaultOptionIds, option.id],
  };
}

export function renameRecoveryOption(rule: RecoveryRule, id: string, label: string): RecoveryRule {
  const text = normalizeOptionLabel(label);
  if (!text) return rule;
  // 다른 옵션이 이미 그 이름이면 두 개가 같은 이름으로 남는다. 그대로 둔다.
  const clash = findRecoveryOption(rule, text);
  if (clash && clash.id !== id) return rule;
  return { ...rule, options: rule.options.map((o) => (o.id === id ? { ...o, label: text } : o)) };
}

/**
 * 옵션 삭제.
 *
 * 지난 회차는 label 스냅샷을 각자 들고 있으므로 여기서 지워도 뜻이 사라지지 않는다.
 * 그래서 과거 항목을 뒤져 고칠 필요가 없다.
 */
export function removeRecoveryOption(rule: RecoveryRule, id: string): RecoveryRule {
  return {
    ...rule,
    options: rule.options.filter((o) => o.id !== id),
    defaultOptionIds: rule.defaultOptionIds.filter((x) => x !== id),
  };
}

/** 정렬. dir 이 -1 이면 위로, 1 이면 아래로 한 칸. */
export function moveRecoveryOption(rule: RecoveryRule, id: string, dir: -1 | 1): RecoveryRule {
  const sorted = [...rule.options].sort((a, b) => a.order - b.order);
  const at = sorted.findIndex((o) => o.id === id);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= sorted.length) return rule;
  const moved = sorted[at]!;
  sorted[at] = sorted[to]!;
  sorted[to] = moved;
  return { ...rule, options: sorted.map((o, i) => ({ ...o, order: i })) };
}

export function toggleDefaultOption(rule: RecoveryRule, id: string): RecoveryRule {
  const on = rule.defaultOptionIds.includes(id);
  return {
    ...rule,
    defaultOptionIds: on
      ? rule.defaultOptionIds.filter((x) => x !== id)
      : [...rule.defaultOptionIds, id],
  };
}

/**
 * 간격 변경.
 *
 * 이미 잡혀 있는 회차나 갚아야 할 빚은 건드리지 않는다. 예정만 비워 두면
 * `primeRule` 이 새 간격으로 다시 채운다.
 */
export function setRecoveryInterval(rule: RecoveryRule, intervalDays: number): RecoveryRule {
  const days = Math.max(1, Math.trunc(intervalDays));
  const next = { ...rule, intervalDays: days };
  if (next.activeEntryId || next.debtCount > 0) return next;
  return { ...next, nextDueAt: null };
}

// ---------- 개별 회차 편집 ----------

export interface RecoveryOptionChoice {
  id: string;
  label: string;
  on: boolean;
  /** Rule 에서 지워진 옵션. 지난 회차의 스냅샷으로만 남아 있다. */
  gone: boolean;
}

/**
 * 이 회차의 OFF 목록 편집 후보.
 *
 * 켜져 있는 항목은 **회차의 스냅샷 이름**으로 보여 준다. 설정에서 이름을 바꿨다고 지난
 * 회차의 표시까지 따라 바뀌면, 그때 무엇을 끄고 쉬었는지가 나중 이름으로 덧칠된다.
 * 아직 고르지 않은 항목만 Rule 의 현재 이름으로 보여 준다 — 지금 새로 켜는 것이니
 * 지금의 이름이 맞다.
 */
export function recoveryOptionChoices(rule: RecoveryRule, entry: Entry): RecoveryOptionChoice[] {
  const chosen = new Map((entry.recovery?.options ?? []).map((o) => [o.id, o.label]));
  const out: RecoveryOptionChoice[] = [...rule.options]
    .sort((a, b) => a.order - b.order)
    .map((o) => ({
      id: o.id,
      label: chosen.get(o.id) ?? o.label,
      on: chosen.has(o.id),
      gone: false,
    }));
  const known = new Set(rule.options.map((o) => o.id));
  for (const [id, label] of chosen) {
    if (!known.has(id)) out.push({ id, label, on: true, gone: true });
  }
  return out;
}

/**
 * 이 회차의 옵션 하나를 켜고 끈다.
 * Rule 기본값은 건드리지 않는다 — 다음 회차는 다시 Rule 기본값으로 시작한다.
 */
export function toggleEntryOption(rule: RecoveryRule, entry: Entry, id: string): Entry {
  const rec = entry.recovery;
  if (!rec) return entry;
  const on = rec.options.some((o) => o.id === id);
  if (on) {
    return withDerived({ ...entry, recovery: { ...rec, options: rec.options.filter((o) => o.id !== id) } });
  }
  const def = rule.options.find((o) => o.id === id);
  if (!def) return entry;
  const order = new Map(rule.options.map((o) => [o.id, o.order]));
  const next = [...rec.options, { id: def.id, label: def.label }]
    .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  return withDerived({ ...entry, recovery: { ...rec, options: next } });
}

/**
 * 회차에서 바로 새 항목을 만든다.
 *
 * 두 층을 한 번에 건드리는 유일한 동작이다 — 목록(Rule)에 더하고, 이 회차에서도 켠다.
 * 여기서 만든 것이 다음 회차부터 기본으로 붙는 것이 의도다. 사용자가 자기 기준을
 * 손으로 쌓아 가는 목록이라, 한 번 적은 항목을 매번 다시 적게 하지 않는다.
 *
 * 같은 이름이 이미 있으면 새로 만들지 않고 그것을 켠다.
 * 만들 것이 없으면(빈 문자열) null 을 돌려준다 — 부르는 쪽이 아무것도 저장하지 않는다.
 */
export function addOptionFromEntry(
  rule: RecoveryRule, entry: Entry, label: string,
): { rule: RecoveryRule; entry: Entry } | null {
  const text = normalizeOptionLabel(label);
  if (!text || !entry.recovery) return null;

  const existing = findRecoveryOption(rule, text);
  const nextRule = addRecoveryOption(rule, text);
  const option = existing
    ?? nextRule.options.find((o) => !rule.options.some((x) => x.id === o.id));
  if (!option) return null;

  const alreadyOn = entry.recovery.options.some((o) => o.id === option.id);
  return {
    rule: nextRule,
    entry: alreadyOn ? entry : toggleEntryOption(nextRule, entry, option.id),
  };
}

/** 이 회차의 메모만 고친다. Rule 기본 메모는 그대로다. */
export function setEntryMemo(entry: Entry, memo: string): Entry {
  return withDerived({ ...entry, note: memo });
}

// ---------- 표시 ----------

export function describeRecoveryRule(rule: RecoveryRule): string {
  if (!rule.enabled) return '사용 안 함';
  const w = recoveryWindow(rule.window);
  return `${rule.intervalDays}일마다 · ${w.label}`;
}

/** 회복 시간대 한 줄. 예: '18:00–23:59' · '하루 종일' */
export function describeRecoveryTime(entry: Entry): string {
  if (!entry.startTime) return '하루 종일';
  return entry.endTime ? `${entry.startTime}–${entry.endTime}` : entry.startTime;
}

export function debtLabel(count: number): string {
  return `회복 ${count}회 밀림`;
}
