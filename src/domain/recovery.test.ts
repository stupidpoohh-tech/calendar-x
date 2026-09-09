/**
 * 회복 규칙 테스트.
 *
 * 이 기능이 지켜야 할 것은 두 줄로 줄어든다.
 *   1. 미리 만들지 않는다 — 지평선 전에는 항목이 없고, 지평선에서는 딱 한 건이다
 *   2. 지워서 빚이 증발하지 않는다 — 옮기기는 세지 않고, 건너뛰기는 센다
 *
 * 나머지(메모·옵션 스냅샷)는 전부 "개별 회차를 고쳐도 Rule 기본값이 물들지 않는다"의
 * 변주다. 시나리오 A~F 를 그대로 옮겼다.
 */
import { describe, expect, it } from 'vitest';
import {
  addOptionFromEntry, addRecoveryOption, buildRecoveryEntry, completeRecovery, defaultRecoveryRule,
  generateRecovery, moveRecovery, moveRecoveryOption, nextDueFrom, primeRule,
  recoveryOptionChoices, removeRecoveryOption, renameRecoveryOption,
  scheduleDebtRecovery, setEntryMemo, setRecoveryInterval, shouldGenerate,
  skipRecovery, snapshotOptions, toggleDefaultOption, toggleEntryOption,
} from './recovery';
import { newEntry } from './entry';
import type { RecoveryRule } from './types';

const rule = (p: Partial<RecoveryRule> = {}): RecoveryRule => ({
  ...defaultRecoveryRule(),
  enabled: true,
  intervalDays: 3,
  generationHorizonDays: 1,
  ...p,
});

describe('nextDue — 마지막 완료일 + 간격', () => {
  it('완료일에서 간격만큼 뒤가 다음 예정일이다', () => {
    expect(nextDueFrom('2026-09-01', 3)).toBe('2026-09-04');
    expect(nextDueFrom('2026-09-30', 3)).toBe('2026-10-03');
  });

  it('간격은 최소 하루다', () => {
    expect(nextDueFrom('2026-09-01', 0)).toBe('2026-09-02');
    expect(nextDueFrom('2026-09-01', -5)).toBe('2026-09-02');
  });

  it('켠 직후에는 오늘 + 간격으로 예정을 채운다', () => {
    const primed = primeRule(rule({ nextDueAt: null }), '2026-09-01');
    expect(primed.nextDueAt).toBe('2026-09-04');
  });

  it('오래 꺼 두었다가 켜도 과거로 예정을 잡지 않는다', () => {
    // 켜 두지 않은 기간은 빚이 아니다. 켜자마자 밀린 것처럼 보이면 안 된다.
    const primed = primeRule(rule({ nextDueAt: null, lastCompletedAt: '2026-06-01' }), '2026-09-01');
    expect(primed.nextDueAt).toBe('2026-09-01');
  });

  it('예정이 이미 있으면 건드리지 않는다', () => {
    const r = rule({ nextDueAt: '2026-09-04' });
    expect(primeRule(r, '2026-09-01')).toBe(r);
  });

  it('빚이 있으면 예정을 자동으로 채우지 않는다 — 다시 잡기가 유일한 길이다', () => {
    const r = rule({ nextDueAt: null, debtCount: 1 });
    expect(primeRule(r, '2026-09-01')).toBe(r);
  });

  it('꺼져 있으면 아무것도 하지 않는다', () => {
    const r = rule({ enabled: false, nextDueAt: null });
    expect(primeRule(r, '2026-09-01')).toBe(r);
  });
});

describe('생성 — 지평선 전에는 캘린더에 아무것도 없다', () => {
  const r = rule({ nextDueAt: '2026-09-04' });

  it('하루 전이 되기 전에는 만들지 않는다', () => {
    expect(shouldGenerate(r, '2026-09-01')).toBe(false);
    expect(shouldGenerate(r, '2026-09-02')).toBe(false);
    expect(generateRecovery(r, '2026-09-02')).toBeNull();
  });

  it('하루 전이 되면 만든다', () => {
    expect(shouldGenerate(r, '2026-09-03')).toBe(true);
    const t = generateRecovery(r, '2026-09-03');
    expect(t?.entry?.startDate).toBe('2026-09-04');
  });

  it('예정일 당일에도(지평선을 지나쳤어도) 만든다', () => {
    expect(shouldGenerate(r, '2026-09-04')).toBe(true);
  });

  it('생성 시점을 당일로 두면 전날에는 만들지 않는다', () => {
    const same = rule({ nextDueAt: '2026-09-04', generationHorizonDays: 0 });
    expect(shouldGenerate(same, '2026-09-03')).toBe(false);
    expect(shouldGenerate(same, '2026-09-04')).toBe(true);
  });

  it('한 건이 이미 잡혀 있으면 두 번째를 만들지 않는다', () => {
    const t = generateRecovery(r, '2026-09-03');
    expect(t).not.toBeNull();
    // activeEntryId 가 채워진 뒤로는 몇 번을 다시 돌려도 늘 null 이다.
    expect(generateRecovery(t!.rule, '2026-09-03')).toBeNull();
    expect(generateRecovery(t!.rule, '2026-09-04')).toBeNull();
    expect(t!.rule.activeEntryId).toBe(t!.entry!.id);
  });

  it('예정이 없으면(빚 대기 중) 만들지 않는다', () => {
    expect(shouldGenerate(rule({ nextDueAt: null, debtCount: 2 }), '2026-09-30')).toBe(false);
  });

  it('꺼져 있으면 만들지 않는다', () => {
    expect(shouldGenerate(rule({ enabled: false, nextDueAt: '2026-09-04' }), '2026-09-30')).toBe(false);
  });

  it('반복 규칙을 쓰지 않는다 — 만들어진 항목은 단발이다', () => {
    const t = generateRecovery(r, '2026-09-03');
    expect(t?.entry?.recurrence).toBeNull();
    expect(t?.entry?.isRecurring).toBe(false);
  });

  it('회복 단위가 시각을 정한다', () => {
    const evening = generateRecovery(r, '2026-09-03');
    expect(evening?.entry?.startTime).toBe('18:00');
    expect(evening?.entry?.endTime).toBe('23:59');

    const day = generateRecovery(rule({ nextDueAt: '2026-09-04', window: 'day' }), '2026-09-03');
    expect(day?.entry?.startTime).toBeNull();
  });
});

describe('Scenario A — 정상 주기', () => {
  it('완료하면 완료일 기준으로 새 간격이 시작한다', () => {
    const t = generateRecovery(rule({ nextDueAt: '2026-09-04' }), '2026-09-03')!;
    const done = completeRecovery(t.rule, t.entry!, '2026-09-04');

    expect(done.rule.lastCompletedAt).toBe('2026-09-04');
    expect(done.rule.nextDueAt).toBe('2026-09-07');
    expect(done.rule.debtCount).toBe(0);
    expect(done.entry?.task?.status).toBe('done');
    // 다음 회차는 아직 만들지 않는다. 하루 전까지는 내부 상태일 뿐이다.
    expect(done.rule.activeEntryId).toBeNull();
    expect(generateRecovery(done.rule, '2026-09-05')).toBeNull();
    expect(generateRecovery(done.rule, '2026-09-06')).not.toBeNull();
  });

  it('예정일과 다른 날 완료해도 기준은 실제 완료일이다', () => {
    const t = generateRecovery(rule({ nextDueAt: '2026-09-04' }), '2026-09-03')!;
    const done = completeRecovery(t.rule, t.entry!, '2026-09-05');
    expect(done.rule.nextDueAt).toBe('2026-09-08');
  });
});

describe('Scenario B — 옮기기', () => {
  it('옮겨도 빚이 생기지 않고 여전히 잡혀 있다', () => {
    const t = generateRecovery(rule({ nextDueAt: '2026-09-04' }), '2026-09-03')!;
    const moved = moveRecovery(t.rule, t.entry!, '2026-09-06', '20:00');

    expect(moved.rule.debtCount).toBe(0);
    expect(moved.rule.nextDueAt).toBe('2026-09-06');
    // 상태가 유지된다 — Scheduled → Move → Scheduled
    expect(moved.rule.activeEntryId).toBe(t.entry!.id);
    expect(moved.entry?.startDate).toBe('2026-09-06');
    expect(moved.entry?.startTime).toBe('20:00');
    expect(moved.entry?.recovery?.movedCount).toBe(1);
    // 옮긴 자리에 또 한 건이 생기면 안 된다.
    expect(generateRecovery(moved.rule, '2026-09-06')).toBeNull();
  });

  it('옮긴 회복을 완료하면 그 완료일에서 새 간격이 시작한다', () => {
    const t = generateRecovery(rule({ nextDueAt: '2026-09-04' }), '2026-09-03')!;
    const moved = moveRecovery(t.rule, t.entry!, '2026-09-06', '20:00');
    const done = completeRecovery(moved.rule, moved.entry!, '2026-09-06');

    expect(done.rule.debtCount).toBe(0);
    expect(done.rule.nextDueAt).toBe('2026-09-09');
  });

  it('옮기기는 ymSpan 을 다시 계산한다', () => {
    const t = generateRecovery(rule({ nextDueAt: '2026-09-30' }), '2026-09-29')!;
    const moved = moveRecovery(t.rule, t.entry!, '2026-10-02', null);
    expect(moved.entry?.ymSpan).toEqual(['2026-10']);
  });
});

describe('Scenario C — 건너뛰기', () => {
  it('건너뛰면 빚이 하나 늘고 항목은 사라진다', () => {
    const t = generateRecovery(rule({ nextDueAt: '2026-09-04' }), '2026-09-03')!;
    const skipped = skipRecovery(t.rule);

    expect(skipped.rule.debtCount).toBe(1);
    expect(skipped.entry).toBeNull();
    // 빚을 갚기 전에는 다음 회복이 저절로 잡히지 않는다.
    expect(skipped.rule.nextDueAt).toBeNull();
    expect(skipped.rule.activeEntryId).toBeNull();
    expect(generateRecovery(skipped.rule, '2026-09-30')).toBeNull();
    expect(primeRule(skipped.rule, '2026-09-30').nextDueAt).toBeNull();
  });

  it('다시 잡아 완료하면 빚이 0이 되고 그 완료일에서 새 간격이 시작한다', () => {
    const t = generateRecovery(rule({ nextDueAt: '2026-09-04' }), '2026-09-03')!;
    const skipped = skipRecovery(t.rule);

    const again = scheduleDebtRecovery(skipped.rule, '2026-09-06', '19:00');
    expect(again.entry?.recovery?.repayment).toBe(true);
    expect(again.rule.debtCount).toBe(1);
    expect(again.entry?.startTime).toBe('19:00');

    const done = completeRecovery(again.rule, again.entry!, '2026-09-06');
    expect(done.rule.debtCount).toBe(0);
    expect(done.rule.nextDueAt).toBe('2026-09-09');
  });
});

describe('Scenario D — 빚 누적과 상환', () => {
  it('두 번 놓치면 2회, 완료할 때마다 하나씩 갚는다', () => {
    let r = rule({ nextDueAt: '2026-09-04' });

    // 9/4 놓침
    const first = generateRecovery(r, '2026-09-03')!;
    r = skipRecovery(first.rule).rule;
    expect(r.debtCount).toBe(1);

    // 다시 잡은 9/7 도 놓침
    const second = scheduleDebtRecovery(r, '2026-09-07', null);
    r = skipRecovery(second.rule).rule;
    expect(r.debtCount).toBe(2);

    // 9/9 완료 → 1
    const third = scheduleDebtRecovery(r, '2026-09-09', null);
    const done1 = completeRecovery(third.rule, third.entry!, '2026-09-09');
    expect(done1.rule.debtCount).toBe(1);
    // 아직 빚이 남아 있으므로 새 간격을 시작하지 않는다.
    expect(done1.rule.nextDueAt).toBeNull();

    // 9/11 완료 → 0, 여기서부터 새 간격
    const fourth = scheduleDebtRecovery(done1.rule, '2026-09-11', null);
    const done2 = completeRecovery(fourth.rule, fourth.entry!, '2026-09-11');
    expect(done2.rule.debtCount).toBe(0);
    expect(done2.rule.lastCompletedAt).toBe('2026-09-11');
    // 원래 열(9/4 · 9/7 · 9/10)을 복원하지 않는다. 간격만 다시 확보한다.
    expect(done2.rule.nextDueAt).toBe('2026-09-14');
  });

  it('빚 상환 회차가 아니면 빚을 줄이지 않는다', () => {
    const r = rule({ nextDueAt: '2026-09-04', debtCount: 2 });
    const t = generateRecovery(r, '2026-09-03')!;
    const done = completeRecovery(t.rule, t.entry!, '2026-09-04');
    expect(done.rule.debtCount).toBe(2);
    // 빚이 남아 있으면 예정을 자동으로 잡지 않는다.
    expect(done.rule.nextDueAt).toBeNull();
  });

  it('빚이 0인데 상환 회차를 완료해도 음수가 되지 않는다', () => {
    const t = scheduleDebtRecovery(rule({ debtCount: 0 }), '2026-09-06', null);
    const done = completeRecovery(t.rule, t.entry!, '2026-09-06');
    expect(done.rule.debtCount).toBe(0);
  });
});

describe('Scenario E — 메모와 옵션', () => {
  const memoRule = rule({
    nextDueAt: '2026-09-04',
    defaultMemo: '오늘은 결과물을 만들지 않는다',
  });

  it('새 회차에 Rule 기본 메모와 기본 옵션이 그대로 들어간다', () => {
    const t = generateRecovery(memoRule, '2026-09-03')!;
    expect(t.entry?.note).toBe('오늘은 결과물을 만들지 않는다');
    expect(t.entry?.recovery?.options.map((o) => o.label))
      .toEqual(['개인 프로젝트', '회사 일', 'AI 작업', '새 산출물']);
  });

  it('기본 선택에서 뺀 옵션은 새 회차에 들어가지 않는다', () => {
    const r = toggleDefaultOption(memoRule, 'work');
    expect(snapshotOptions(r).map((o) => o.id)).toEqual(['personal', 'ai', 'output']);
  });

  it('회차의 메모를 고쳐도 Rule 기본 메모는 그대로다', () => {
    const t = generateRecovery(memoRule, '2026-09-03')!;
    const edited = setEntryMemo(t.entry!, '이번엔 산책만');

    expect(edited.note).toBe('이번엔 산책만');
    expect(t.rule.defaultMemo).toBe('오늘은 결과물을 만들지 않는다');

    // 다음 회차는 다시 Rule 기본값에서 시작한다.
    const done = completeRecovery(t.rule, edited, '2026-09-04');
    const next = generateRecovery(done.rule, '2026-09-06')!;
    expect(next.entry?.note).toBe('오늘은 결과물을 만들지 않는다');
  });

  it('회차의 옵션을 꺼도 Rule 기본 선택은 그대로다', () => {
    const t = generateRecovery(memoRule, '2026-09-03')!;
    const off = toggleEntryOption(t.rule, t.entry!, 'work');

    expect(off.recovery?.options.map((o) => o.id)).toEqual(['personal', 'ai', 'output']);
    expect(t.rule.defaultOptionIds).toContain('work');

    // 다음 회차에는 다시 네 개 전부 들어온다.
    const done = completeRecovery(t.rule, off, '2026-09-04');
    const next = generateRecovery(done.rule, '2026-09-06')!;
    expect(next.entry?.recovery?.options).toHaveLength(4);
  });

  it('껐던 옵션을 다시 켜면 Rule 순서 자리로 돌아간다', () => {
    const t = generateRecovery(memoRule, '2026-09-03')!;
    const off = toggleEntryOption(t.rule, t.entry!, 'work');
    const on = toggleEntryOption(t.rule, off, 'work');
    expect(on.recovery?.options.map((o) => o.id)).toEqual(['personal', 'work', 'ai', 'output']);
  });
});

describe('Scenario F — 옵션 관리', () => {
  it('추가하면 기본 선택에도 함께 들어간다', () => {
    const r = addRecoveryOption(rule(), '과외 준비');
    const added = r.options.at(-1)!;
    expect(added.label).toBe('과외 준비');
    expect(r.defaultOptionIds).toContain(added.id);
    expect(snapshotOptions(r).map((o) => o.label)).toContain('과외 준비');
  });

  it('빈 이름은 추가하지 않는다', () => {
    const r = rule();
    expect(addRecoveryOption(r, '   ')).toBe(r);
  });

  it('이름을 바꾸면 새 회차부터 새 이름이 들어간다', () => {
    const r = renameRecoveryOption(rule(), 'work', '본업');
    expect(snapshotOptions(r).map((o) => o.label)).toContain('본업');
  });

  it('순서를 바꾸면 새 회차의 스냅샷 순서도 따라간다', () => {
    const r = moveRecoveryOption(rule(), 'ai', -1);
    expect(r.options.sort((a, b) => a.order - b.order).map((o) => o.id))
      .toEqual(['personal', 'ai', 'work', 'output']);
    expect(snapshotOptions(r).map((o) => o.id)).toEqual(['personal', 'ai', 'work', 'output']);
  });

  it('끝에서 더 움직이라고 해도 아무 일도 일어나지 않는다', () => {
    const r = rule();
    expect(moveRecoveryOption(r, 'personal', -1)).toBe(r);
    expect(moveRecoveryOption(r, 'output', 1)).toBe(r);
  });

  it('삭제하면 기본 선택에서도 빠진다', () => {
    const r = removeRecoveryOption(rule(), 'ai');
    expect(r.options.map((o) => o.id)).not.toContain('ai');
    expect(r.defaultOptionIds).not.toContain('ai');
  });

  it('옵션을 지워도 지난 회차의 뜻이 남는다', () => {
    const t = generateRecovery(rule({ nextDueAt: '2026-09-04' }), '2026-09-03')!;
    const past = t.entry!;

    const after = removeRecoveryOption(renameRecoveryOption(t.rule, 'work', '본업'), 'ai');

    // 스냅샷은 그대로다. 지운 옵션도, 이름을 바꾼 옵션도 그때의 이름으로 남는다.
    expect(past.recovery?.options.map((o) => o.label))
      .toEqual(['개인 프로젝트', '회사 일', 'AI 작업', '새 산출물']);

    // 화면에도 그대로 뜨고, 지워진 것만 따로 표시된다.
    const choices = recoveryOptionChoices(after, past);
    const gone = choices.filter((c) => c.gone);
    expect(gone.map((c) => c.label)).toEqual(['AI 작업']);
    expect(choices.every((c) => c.on)).toBe(true);
    // 이름을 바꿔도 이 회차의 표시는 그때의 이름이다. 나중 이름으로 덧칠하지 않는다.
    expect(choices.find((c) => c.id === 'work')?.label).toBe('회사 일');
  });

  it('아직 고르지 않은 항목은 Rule 의 현재 이름으로 보여 준다', () => {
    const t = generateRecovery(rule({ nextDueAt: '2026-09-04' }), '2026-09-03')!;
    const off = toggleEntryOption(t.rule, t.entry!, 'work');
    const renamed = renameRecoveryOption(t.rule, 'work', '본업');

    const choice = recoveryOptionChoices(renamed, off).find((c) => c.id === 'work');
    // 지금 새로 켜는 것이니 지금의 이름이 맞다.
    expect(choice).toEqual({ id: 'work', label: '본업', on: false, gone: false });
    // 다시 켜면 그 이름으로 기록된다.
    expect(toggleEntryOption(renamed, off, 'work').recovery?.options.find((o) => o.id === 'work')?.label)
      .toBe('본업');
  });

  it('지워진 옵션은 회차에서 끌 수는 있어도 다시 켜지지 않는다', () => {
    const t = generateRecovery(rule({ nextDueAt: '2026-09-04' }), '2026-09-03')!;
    const after = removeRecoveryOption(t.rule, 'ai');

    const off = toggleEntryOption(after, t.entry!, 'ai');
    expect(off.recovery?.options.map((o) => o.id)).toEqual(['personal', 'work', 'output']);
    // 정의가 없으니 이름을 알 수 없다. 되살리지 않는 편이 빈 라벨보다 낫다.
    expect(toggleEntryOption(after, off, 'ai')).toBe(off);
  });

  it('옵션을 전부 지우면 회차는 끌 항목 없이 생긴다', () => {
    let r = rule({ nextDueAt: '2026-09-04' });
    for (const id of ['personal', 'work', 'ai', 'output']) r = removeRecoveryOption(r, id);
    const t = generateRecovery(r, '2026-09-03')!;
    expect(t.entry?.recovery?.options).toEqual([]);
  });
});

describe('회차에서 바로 항목 만들기', () => {
  it('목록에 더하고 이 회차에서도 켠다', () => {
    const t = generateRecovery(rule({ nextDueAt: '2026-09-04' }), '2026-09-03')!;
    const next = addOptionFromEntry(t.rule, t.entry!, '사우나')!;

    expect(next.rule.options.map((o) => o.label)).toContain('사우나');
    expect(next.entry.recovery?.options.map((o) => o.label)).toContain('사우나');
    // 손으로 쌓아 가는 목록이라 다음 회차부터 기본으로 붙는다.
    const added = next.rule.options.find((o) => o.label === '사우나')!;
    expect(next.rule.defaultOptionIds).toContain(added.id);
    expect(snapshotOptions(next.rule).map((o) => o.label)).toContain('사우나');
  });

  it('빈 이름이면 아무것도 하지 않는다', () => {
    const t = generateRecovery(rule({ nextDueAt: '2026-09-04' }), '2026-09-03')!;
    expect(addOptionFromEntry(t.rule, t.entry!, '   ')).toBeNull();
  });

  it('앞뒤 공백과 중복 공백을 정리해 넣는다', () => {
    const t = generateRecovery(rule({ nextDueAt: '2026-09-04' }), '2026-09-03')!;
    const next = addOptionFromEntry(t.rule, t.entry!, '  유튜브   보기 ')!;
    expect(next.rule.options.map((o) => o.label)).toContain('유튜브 보기');
  });

  it('이미 있는 이름이면 새로 만들지 않고 그것을 켠다', () => {
    const t = generateRecovery(rule({ nextDueAt: '2026-09-04' }), '2026-09-03')!;
    // 이 회차에서 끈 항목을 같은 이름으로 다시 적는 경우.
    const off = toggleEntryOption(t.rule, t.entry!, 'work');
    const next = addOptionFromEntry(t.rule, off, '회사 일')!;

    expect(next.rule.options).toHaveLength(4);
    expect(next.entry.recovery?.options.map((o) => o.id)).toContain('work');
  });

  it('이미 켜져 있는 이름을 다시 적어도 두 번 들어가지 않는다', () => {
    const t = generateRecovery(rule({ nextDueAt: '2026-09-04' }), '2026-09-03')!;
    const next = addOptionFromEntry(t.rule, t.entry!, '회사 일')!;
    expect(next.entry).toBe(t.entry);
    expect(next.entry.recovery?.options).toHaveLength(4);
  });

  it('회복 표식이 없는 항목에는 아무것도 하지 않는다', () => {
    const plain = newEntry('task', { title: '스크럼' });
    expect(addOptionFromEntry(rule(), plain, '사우나')).toBeNull();
  });
});

describe('같은 이름 막기', () => {
  it('목록에 같은 이름을 두 번 만들지 않는다', () => {
    const r = addRecoveryOption(addRecoveryOption(rule(), '사우나'), '사우나');
    expect(r.options.filter((o) => o.label === '사우나')).toHaveLength(1);
  });

  it('대소문자와 공백만 다른 이름도 같은 것으로 본다', () => {
    const r = addRecoveryOption(addRecoveryOption(rule(), 'Netflix'), '  netflix ');
    expect(r.options.filter((o) => /netflix/i.test(o.label))).toHaveLength(1);
  });

  it('꺼 둔 기본 항목을 같은 이름으로 다시 적으면 다시 켜진다', () => {
    const off = toggleDefaultOption(rule(), 'work');
    expect(off.defaultOptionIds).not.toContain('work');
    const back = addRecoveryOption(off, '회사 일');
    expect(back.options).toHaveLength(4);
    expect(back.defaultOptionIds).toContain('work');
  });

  it('다른 항목이 쓰는 이름으로는 바꾸지 않는다', () => {
    const r = rule();
    expect(renameRecoveryOption(r, 'ai', '회사 일')).toBe(r);
    // 자기 이름을 다듬는 것은 된다.
    expect(renameRecoveryOption(r, 'ai', ' AI 작업 ').options.find((o) => o.id === 'ai')?.label)
      .toBe('AI 작업');
  });
});

describe('간격 변경', () => {
  it('예정을 비워 두면 다음 prime 이 새 간격으로 채운다', () => {
    const r = setRecoveryInterval(rule({ nextDueAt: '2026-09-04' }), 7);
    expect(r.intervalDays).toBe(7);
    expect(r.nextDueAt).toBeNull();
    expect(primeRule(r, '2026-09-02').nextDueAt).toBe('2026-09-09');
  });

  it('이미 잡혀 있는 회차는 건드리지 않는다', () => {
    const t = generateRecovery(rule({ nextDueAt: '2026-09-04' }), '2026-09-03')!;
    const r = setRecoveryInterval(t.rule, 7);
    expect(r.nextDueAt).toBe('2026-09-04');
    expect(r.activeEntryId).toBe(t.entry!.id);
  });

  it('갚아야 할 빚이 있으면 예정을 건드리지 않는다', () => {
    const r = setRecoveryInterval(rule({ nextDueAt: null, debtCount: 2 }), 7);
    expect(r.nextDueAt).toBeNull();
    expect(r.debtCount).toBe(2);
  });
});

describe('항목의 모습', () => {
  it('회복 표식이 있어야 회복 항목이다', () => {
    const e = buildRecoveryEntry(rule(), '2026-09-04');
    expect(e.recovery).not.toBeNull();
    expect(e.kind).toBe('task');
    expect(e.title).toBe('Recovery — OUTPUT OFF');
    expect(e.task?.status).toBe('planned');
  });

  it('회차마다 다른 id 를 갖는다', () => {
    const a = buildRecoveryEntry(rule(), '2026-09-04');
    const b = buildRecoveryEntry(rule(), '2026-09-07');
    expect(a.id).not.toBe(b.id);
  });

  it('스냅샷은 Rule 옵션 배열과 같은 객체를 공유하지 않는다', () => {
    const r = rule();
    const e = buildRecoveryEntry(r, '2026-09-04');
    e.recovery!.options[0]!.label = '바뀜';
    expect(r.options[0]!.label).toBe('개인 프로젝트');
  });
});
