import { describe, expect, it } from 'vitest';
import { newEntry } from '../domain/entry';
import { BackupParseError, buildBackup, countBackup, mergeBackup, parseBackup } from './backup';
import type { Account } from '../domain/types';

const account: Account = {
  id: 'a1', name: '주계좌', balanceMinor: 1_000_000, currency: 'KRW',
  asOf: '2026-08-01', order: 0, createdAt: '', updatedAt: '',
};

describe('buildBackup / parseBackup 왕복', () => {
  it('내보낸 것을 그대로 되읽는다', () => {
    const data = { entries: [newEntry('task', { title: '치과' })], accounts: [account], debts: [], pins: [] };
    const restored = parseBackup(JSON.stringify(buildBackup(data)));
    expect(restored.entries[0]?.title).toBe('치과');
    expect(restored.accounts[0]?.balanceMinor).toBe(1_000_000);
    expect(countBackup(restored)).toBe(2);
  });
});

describe('parseBackup — 이관 전 형식', () => {
  it('version 1 백업 파일도 받는다 — 손에 남아 있는 파일을 버리지 않는다', () => {
    const old = {
      app: 'Dada Calendar', version: 1, exportedAt: '2026-08-01T00:00:00.000Z',
      items: [
        { id: 'a1', tab: 'todo', title: '치과', startISO: '2026-08-03', status: 'planned', color: 'red', tags: [], memo: '' },
        { id: 'e1', tab: 'money', title: '::balance::', memo: '500000', dateISO: '2026-08-01' },
      ],
    };
    const r = parseBackup(JSON.stringify(old));
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.kind).toBe('task');
    expect(r.accounts[0]?.balanceMinor).toBe(500_000);
  });
});

describe('parseBackup — 오류', () => {
  it('JSON 이 아니면 무엇이 잘못됐는지 말한다', () => {
    expect(() => parseBackup('{not json')).toThrow(BackupParseError);
    expect(() => parseBackup('{not json')).toThrow(/JSON/);
  });
  it('항목이 없으면 거부한다', () => {
    expect(() => parseBackup(JSON.stringify({ app: 'other' }))).toThrow(/항목/);
  });
  it('id 없는 항목은 흘려보낸다', () => {
    const r = parseBackup(JSON.stringify({ entries: [{ title: 'id 없음' }, { id: 'ok', title: '정상', kind: 'task', startDate: '2026-08-01' }] }));
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.id).toBe('ok');
  });
});

describe('mergeBackup', () => {
  it('같은 id 는 원본을 남긴다', () => {
    const a = newEntry('task', { id: 'x', title: '원본' });
    const b = newEntry('task', { id: 'x', title: '들어온 것' });
    const c = newEntry('task', { id: 'y', title: '새 항목' });
    const merged = mergeBackup(
      { entries: [a], accounts: [], debts: [], pins: [] },
      { entries: [b, c], accounts: [], debts: [], pins: [] },
    );
    expect(merged.entries).toHaveLength(2);
    expect(merged.entries.find((e) => e.id === 'x')?.title).toBe('원본');
  });
});
