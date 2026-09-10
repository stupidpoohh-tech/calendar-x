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
import { settle, summarize, type Settlement } from '../domain/tide';
import type { Account, Entry } from '../domain/types';
import { useDialog } from './Dialog';
import { Icon } from './Icon';

export interface BalanceEditor {
  /** 지금 고치고 있는 계좌. 계좌가 없으면 null (첫 입력). */
  primary: Account | null;
  /** 고를 수 있는 계좌 전부. 하나뿐이면 화면에 고르는 자리를 두지 않는다. */
  accounts: readonly Account[];
  /** 편집 대상을 바꾼다. 금액칸도 그 계좌의 값으로 다시 채운다. */
  pick: (id: string) => void;
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
  /*
    편집은 **계좌 한 개**를 대상으로 한다.

    예전에는 합계(모든 계좌의 balanceMinor 합)를 보여 주면서 저장은 첫 계좌에만 했다.
    계좌가 둘이면 적은 금액이 첫 계좌로 통째로 들어가 나머지 계좌의 잔고와 이중으로
    세어졌다. 지금은 고른 계좌의 잔고만 바꾸고, 정산은 "나머지 계좌 합 + 새 금액" 을
    새 총액으로 삼아 잰다.
  */
  const [targetId, setTargetId] = useState<string | null>(null);
  const primary = accounts.find((a) => a.id === targetId) ?? accounts[0] ?? null;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const dialog = useDialog();

  const start = () => {
    setText(primary ? minorToInput(primary.balanceMinor, primary.currency) : '');
    setEditing(true);
  };

  const pick = (id: string) => {
    const next = accounts.find((a) => a.id === id);
    if (!next) return;
    setTargetId(id);
    setText(minorToInput(next.balanceMinor, next.currency));
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

    // 고른 계좌만 바뀐다. 나머지 계좌 잔고는 그대로 새 총액에 들어간다.
    const others = accounts.reduce((t, a) => (a.id === primary.id ? t : t + a.balanceMinor), 0);
    const newTotal = others + minor;
    const multi = accounts.length > 1;
    const r = settle(accounts, entries, newTotal, today, coveredFrom);
    const items = summarize(r.passed);

    // 정산할 예정도 없고 diff 도 0 이면 조용히 저장.
    if (r.complete && r.passed.length === 0 && r.diff === 0) { onSave(build()); return; }

    /*
      확정 차액을 낼 수 없는 경우. 그럴듯하게 틀린 숫자를 내느니 무엇이 모자란지
      말하고 잔고만 갱신한다.
    */
    if (!r.complete) {
      void (async () => {
        const ok = await dialog.confirm({
          title: '정산 금액을 확정할 수 없습니다',
          body: <SettleGap settlement={r} />,
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
              {/* 계좌가 여럿이면 정산의 기준은 총액이다. 방금 적은 한 계좌 금액을
                  적어 두면 차액과 맞지 않아 보인다. */}
              {multi ? '새 총액' : '새로 적은'} <b className="num">₩ {formatAmount(newTotal)}</b>과
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

  return {
    primary, accounts, pick,
    editing, text, setText, start, cancel: () => setEditing(false), commit,
  };
}

/** 확정 차액을 낼 수 없는 이유. 세 갈래가 각각 다른 말을 한다. */
function SettleGap({ settlement: r }: { settlement: Settlement }) {
  if (r.reason === 'currency') {
    return (
      <div className="settle">
        <p>통화가 섞여 있습니다 — <b>{r.detail.join(' · ')}</b>.</p>
        <p className="dlg-note">
          이 앱은 <b>한 번에 한 통화</b>만 다룹니다. 환율 변환을 하지 않으므로 서로 다른
          통화의 금액을 더하지 않습니다. 잔고만 새 금액으로 바꿔 둘까요?
        </p>
      </div>
    );
  }

  if (r.reason === 'accounts') {
    return (
      <div className="settle">
        <p>
          계좌마다 마지막으로 적은 날이 다릅니다 —{' '}
          <b>{r.detail.map((d) => fmtDayShort(d)).join(' · ')}</b>.
        </p>
        <p className="dlg-note">
          정산은 총액 하나를 그 구간의 예정과 비교하는 일이라, 계좌마다 구간이 다르면
          하나로 잴 수 없습니다. 계좌 잔고를 <b>같은 날 함께</b> 적으면 그 다음부터
          차액이 나옵니다. 지금은 잔고만 바꿔 둘까요?
        </p>
      </div>
    );
  }

  return (
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
  );
}

/** 큰 숫자를 누르면 그 자리에 뜨는 입력칸. */
export function BalanceInput({ editor, size = 'lg' }: { editor: BalanceEditor; size?: 'lg' | 'sm' }) {
  return (
    <div className={'bal-edit-row ' + size}>
      {/* 계좌가 하나면 고를 것이 없다. 여럿일 때만 어느 계좌를 고치는지 밝힌다. */}
      {editor.accounts.length > 1 && (
        <select
          className="bal-acc"
          aria-label="고칠 계좌"
          value={editor.primary?.id ?? ''}
          onChange={(e) => editor.pick(e.target.value)}
        >
          {editor.accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      )}
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
      <span>
        {editor.primary
          ? (editor.accounts.length > 1
            ? `${editor.primary.name} ${editor.primary.asOf} 기준`
            : `잔고 ${editor.primary.asOf} 기준`)
          : '잔고를 적어 두세요'}
      </span>
      <span className="bal-note-a">{editor.primary ? '수정' : '입력'}</span>
    </button>
  );
}
