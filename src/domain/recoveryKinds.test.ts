import { describe, expect, it } from 'vitest';
import { addOptionFromEntry, addRecoveryOption, buildRecoveryEntry, defaultRecoveryRule, recoveryOptionChoices, recoveryOptionKind, removeRecoveryOption, renameRecoveryOption, setRecoveryOptionKind } from './recovery';
import { entryFromDoc, entryToDoc, recoveryRuleFromDoc, recoveryRuleToDoc } from '../data/converters';
import { buildBackup } from '../data/backup';
import { readBackupFile } from '../data/backupFile';

describe('회복 항목의 끌 것 / 할 것', () => {
  it('기존 문서는 끌 것으로 읽으며 새 활동의 분류는 저장 후에도 유지한다', () => {
    const legacy = recoveryRuleFromDoc({ options: [{ id: 'old', label: '일', order: 0 }], defaultOptionIds: ['old'] });
    expect(recoveryOptionKind(legacy.options[0]!)).toBe('off');
    const rule = addRecoveryOption(legacy, '명상', 'do');
    const saved = recoveryRuleFromDoc(recoveryRuleToDoc(rule));
    expect(saved.options).toEqual(rule.options);
    const entry = buildRecoveryEntry(saved, '2026-10-17');
    expect(entryFromDoc(entry.id, entryToDoc(entry)).recovery).toEqual(entry.recovery);
    expect(entry.recovery?.options.find((o) => o.label === '명상')?.kind).toBe('do');
  });
  it('같은 구분에서만 중복을 막고 다른 구분에는 같은 이름도 만들 수 있다', () => {
    const off = addRecoveryOption(defaultRecoveryRule(), '일', 'off');
    const both = addRecoveryOption(off, '일', 'do');
    expect(both.options.length).toBe(off.options.length + 1);
    expect(addRecoveryOption(both, '  일  ', 'do')).toBe(both);
    const target = both.options.find((o) => o.label === '일' && o.kind === 'off')!;
    expect(setRecoveryOptionKind(both, target.id, 'do')).toBe(both);
  });
  it('기존 항목의 분류·이름 변경과 삭제가 지난 회차의 스냅샷을 바꾸지 않는다', () => {
    const rule = addRecoveryOption(defaultRecoveryRule(), '사우나');
    const option = rule.options.find((o) => o.label === '사우나')!;
    const entry = buildRecoveryEntry(rule, '2026-10-17');
    const changed = renameRecoveryOption(setRecoveryOptionKind(rule, option.id, 'do'), option.id, '온천');
    expect(recoveryOptionKind(changed.options.find((o) => o.id === option.id)!)).toBe('do');
    const old = recoveryOptionChoices(changed, entry).find((o) => o.id === option.id)!;
    expect(old.label).toBe('사우나');
    expect(recoveryOptionKind(old)).toBe('off');
    const gone = recoveryOptionChoices(removeRecoveryOption(changed, option.id), entry).find((o) => o.id === option.id)!;
    expect(gone.gone).toBe(true);
    expect(recoveryOptionKind(gone)).toBe('off');
    expect(buildRecoveryEntry(changed, '2026-10-20').recovery?.options.find((o) => o.id === option.id)).toMatchObject({ label: '온천', kind: 'do' });
  });
  it('회차에서 추가하면 그 회차와 다음 기본값에 같은 분류를 저장한다', () => {
    const rule = defaultRecoveryRule();
    const entry = buildRecoveryEntry(rule, '2026-10-17');
    const result = addOptionFromEntry(rule, entry, '명상', 'do')!;
    expect(result.rule.options.find((o) => o.label === '명상')?.kind).toBe('do');
    expect(result.entry.recovery?.options.find((o) => o.label === '명상')?.kind).toBe('do');
    expect(entry.recovery?.options.some((o) => o.label === '명상')).toBe(false);
  });
  it('백업 왕복에서 규칙과 과거 회차의 서로 다른 분류를 보존한다', () => {
    const rule = addRecoveryOption(defaultRecoveryRule(), '사우나');
    const option = rule.options.find((o) => o.label === '사우나')!;
    const entry = buildRecoveryEntry(rule, '2026-10-17');
    const data = { entries: [entry], accounts: [], debts: [], pins: [], budgets: [], reserves: [], categories: [], categoryBudgets: [], ledgerNotes: [], annualBudgets: [], cards: [], ledger: null, recovery: setRecoveryOptionKind(rule, option.id, 'do') };
    const file = buildBackup(data);
    expect(file.version).toBe(12);
    const result = readBackupFile(JSON.stringify(file));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.data.recovery?.options.find((o) => o.id === option.id)?.kind).toBe('do');
    expect(recoveryOptionKind(result.file.data.entries[0]!.recovery!.options.find((o) => o.id === option.id)!)).toBe('off');
    const legacy = readBackupFile(JSON.stringify({ ...file, version: 11 }));
    expect(legacy.ok).toBe(true);
  });
});
