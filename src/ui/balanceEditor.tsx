/**
 * 잔고 편집. 카드가 아니라 부품이다.
 *
 * 잔고를 독립 카드로 세우면 한도와 같은 금액일 때 같은 숫자가 두 번(오늘 카드까지
 * 치면 세 번) 뜬다. 예정된 입출금이 없는 구간에서는 한도가 곧 잔고라 늘 겹친다.
 * 그래서 화면에 잔고 금액을 따로 적지 않는다 — 큰 숫자 하나를 눌러 고치고,
 * 그 아래에는 "언제 적은 값인지" 만 남긴다.
 *
 * 이 파일은 그 편집 상태(useBalanceEditor)와 두 조각(입력칸·기준 줄)만 내놓는다.
 * 어떤 숫자를 눌러 편집을 여는지는 카드가 정한다.
 */
import { useState } from 'react';
import { DEFAULT_CURRENCY } from '../domain/constants';
import { fmtDayShort, todayISO as domainToday } from '../domain/date';
import { uid } from '../domain/entry';
import { formatAmount, formatSigned, minorToInput, parseAmountToMinor } from '../domain/money';
import { settle, summarize } from '../domain/tide';
import type { Account, Entry } from '../domain/types';
import { useDialog } from './Dialog';
import { Icon } from './Icon';

export interface BalanceEditor {
  primary: Account | null;
  editing: boolean;
  text: string;
  setText: (s: string) => void;
  start: () => void;
  cancel: () => void;
  commit: () => void;
}

export function useBalanceEditor(
  accounts: readonly Account[],
  entries: readonly Entry[],
  onSave: (a: Account) => void,
  /** `entries` 가 덮는 가장 이른 날. 기준일이 이보다 앞서면 정산 금액을 확정할 수 없다. */
  coveredFrom?: string | null,
  /** 오늘. 자정을 넘긴 뒤 저장해도 어제 날짜로 적히지 않도록 위에서 받는다. */
  todayISO?: string,
): BalanceEditor {
  const primary = accounts[0] ?? null;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const dialog = useDialog();

  const start = () => {
    setText(primary ? minorToInput(primary.balanceMinor, primary.currency) : '');
    setEditing(true);
  };

  /**
   * 잔고를 갈아엎는 순간이 정산이다. 예정된 것과 실제 잔고 사이 차이(diff)를
   * 사용자에게 알린 뒤 저장한다. 이 한 순간이 "과거 지출을 입력하지 않는다"의
   * 반대편 — 그 사이 실제로 쓴 돈을 여기서 청산한다.
   */
  const commit = () => {
    // prop 이 없으면(테스트 등) 그 순간에 잰다. 화면에서는 언제나 위에서 내려온다.
    const today = todayISO ?? domainToday();
    const minor = parseAmountToMinor(text);
    setEditing(false);
    if (minor === null) return;

    const now = new Date().toISOString();
    const build = (): Account => ({
      id: primary?.id ?? uid(),
      name: primary?.name ?? '주계좌',
      balanceMinor: minor,
      currency: primary?.currency ?? DEFAULT_CURRENCY,
      // 잔고를 고친 날·시각이 tide 계산의 기준점이다. 시각까지 남겨야
      // 하루 안에 두 번 갈아엎을 때도 정산이 순서대로 잡힌다.
      asOf: today,
      checkedAt: now,
      order: primary?.order ?? 0,
      createdAt: primary?.createdAt || now,
      updatedAt: now,
    });

    // 이전 잔고가 없으면 정산할 것도 없다 — 첫 입력.
    if (!primary) { onSave(build()); return; }

    const r = settle(accounts, entries, minor, today, coveredFrom);
    const items = summarize(r.passed);

    // 정산할 예정도 없고 diff 도 0 이면 조용히 저장.
    if (r.complete && r.passed.length === 0 && r.diff === 0) { onSave(build()); return; }

    /*
      자료가 모자라면 차액을 확정 금액으로 내지 않는다.
      기준일이 계산 구독 구간보다 앞서면 그 사이의 비반복 입출금이 목록에 없어서,
      "예정대로면 얼마" 가 실제보다 크게 나온다. 그럴듯하게 틀린 숫자를 내느니
      무엇이 빠졌는지 말하고 잔고만 갱신하는 편이 낫다.
    */
    if (!r.complete) {
      void (async () => {
        const ok = await dialog.confirm({
          title: '정산 금액을 확정할 수 없습니다',
          body: (
            <div className="settle">
              <p>
                잔고 기준일이 <b>{fmtDayShort(r.since)}</b>로,
                지금 불러와 둔 구간(<b>{fmtDayShort(r.coveredFrom ?? r.since)}</b> 이후)보다 앞섭니다.
              </p>
              <p className="dlg-note">
                그 사이의 <b>한 번짜리</b> 입출금이 목록에 없어 차액을 정확히 낼 수 없습니다.
                (반복 항목은 전부 들어 있습니다.) 잔고만 새 금액으로 바꿔 둘까요?
              </p>
            </div>
          ),
          confirmLabel: '잔고만 바꾸기',
        });
        if (ok) onSave(build());
      })();
      return;
    }

    void (async () => {
      const ok = await dialog.confirm({
        title: '잔고 정산',
        body: (
          <div className="settle">
            <p>
              <b>{fmtDayShort(r.since)}</b> 이후 예정대로면 <b className="num">₩ {formatAmount(r.expected)}</b>이어야 합니다.
            </p>
            {items.length > 0 && (
              <ul className="settle-list">
                {items.map((it) => (
                  <li key={it.key}>
                    <span className="num">{fmtDayShort(it.from)}</span>
                    <span>{it.entry.title || it.entry.money?.type}</span>
                    <span className="num">
                      {formatSigned((it.entry.money && it.entry.money.type === 'income' ? 1 : -1) * it.amountMinor)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="settle-diff">
              새로 적은 <b className="num">₩ {formatAmount(minor)}</b>과
              <b className={'num ' + (r.diff < 0 ? 'minus' : r.diff > 0 ? 'plus' : '')}>
                {' '}차이 {formatSigned(r.diff)}
              </b>
              {r.diff < 0 ? ' — 예정에 없던 지출이 있었네요.' : r.diff > 0 ? ' — 예정보다 남았어요.' : ''}
            </p>
          </div>
        ),
        confirmLabel: '이 금액으로 정산',
      });
      if (ok) onSave(build());
    })();
  };

  return { primary, editing, text, setText, start, cancel: () => setEditing(false), commit };
}

/** 큰 숫자를 누르면 그 자리에 뜨는 입력칸. */
export function BalanceInput({ editor, size = 'lg' }: { editor: BalanceEditor; size?: 'lg' | 'sm' }) {
  return (
    <div className={'bal-edit-row ' + size}>
      <label className="bal-edit-l" htmlFor="bal-input">잔고</label>
      <input
        id="bal-input"
        className="bal-in num" type="text" inputMode="numeric" autoFocus
        value={editor.text} onChange={(e) => editor.setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') editor.commit();
          if (e.key === 'Escape') editor.cancel();
        }}
        onBlur={editor.commit}
        placeholder="0"
        aria-label="잔고 금액"
      />
    </div>
  );
}

/**
 * 큰 숫자 아래 한 줄. 금액을 다시 적지 않고 "언제 적은 값인지" 만 남긴다 —
 * 정산의 기준점이 언제인지가 실제로 쓸모 있는 정보다.
 */
export function BalanceNote({ editor }: { editor: BalanceEditor }) {
  return (
    <button type="button" className="bal-note" onClick={editor.start}>
      <Icon.Wallet size={12} />
      <span>{editor.primary ? `잔고 ${editor.primary.asOf} 기준` : '잔고를 적어 두세요'}</span>
      <span className="bal-note-a">{editor.primary ? '수정' : '입력'}</span>
    </button>
  );
}
