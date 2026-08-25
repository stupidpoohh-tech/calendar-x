import { useId, useState } from 'react';
import { type Occurrence, formatWon } from '../lib/calc';
import {
  type ISODate,
  addDays,
  compareDate,
  formatDate,
  fromISODate,
  todayISO,
  toISODate,
} from '../lib/date';
import {
  type Entry,
  type EntryKind,
  type Schedule,
  type SpanColor,
  SPAN_COLORS,
  SPAN_COLOR_LABEL,
  newId,
  spanColorOf,
} from '../lib/types';
import { Modal, ModalHeader } from './Modal';
import { MoneyInput } from './MoneyInput';

/** 달력 셀에서 열렸을 때 그 날의 맥락. */
export type DayContext = {
  date: ISODate;
  limit: number;
  items: Occurrence[];
};

type Repeat = Schedule['type'];

type Props = {
  day?: DayContext;
  today: ISODate;
  /** 있으면 수정 모드 — 폼이 이 항목으로 채워진다. */
  initial?: Entry;
  onAdd?: (entry: Entry) => void;
  onUpdate?: (entry: Entry) => void;
  onRemove: (id: string) => void;
  /** 목록의 항목을 눌러 수정으로 넘어갈 때. */
  onEdit?: (entry: Entry) => void;
  onClose: () => void;
};

export function EntryDialog({
  day,
  today,
  initial,
  onAdd,
  onUpdate,
  onRemove,
  onEdit,
  onClose,
}: Props) {
  const titleId = useId();

  /** 지난 날은 잔고가 이미 말해준 구간이라 "이 날까지의 한도"가 뜻을 갖지 않는다. */
  const dayIsPast = Boolean(day && compareDate(day.date, today) < 0);
  /** 셀에서 열었으면 그 날짜로 시작한다. 지난 날짜여도 그대로 쓴다. */
  const createDate = day?.date ?? addDays(today, 1);

  const [kind, setKind] = useState<EntryKind>(initial?.kind ?? 'expense');
  const [name, setName] = useState(initial?.name ?? '');
  const [amount, setAmount] = useState(initial?.amount ?? 0);
  const [repeat, setRepeat] = useState<Repeat>(initial?.schedule.type ?? 'once');
  const [everyDays, setEveryDays] = useState(
    initial?.schedule.type === 'every' ? initial.schedule.days : 7,
  );
  const [date, setDate] = useState<ISODate>(() =>
    initial ? startDateOf(initial.schedule) : createDate,
  );
  const [spanEnd, setSpanEnd] = useState<ISODate>(() =>
    initial?.schedule.type === 'span' ? initial.schedule.end : addDays(createDate, 7),
  );
  const [color, setColor] = useState<SpanColor>(() => (initial ? spanColorOf(initial) : 'rose'));
  /** 목록에서 금액만 그 자리에서 고치는 중인 항목. */
  const [tweaking, setTweaking] = useState<{ id: string; amount: number } | null>(null);
  /** ×를 누른 항목. 되돌릴 수 없는 삭제라 한 번 더 받는다(설정의 초기화와 같은 방식). */
  const [removing, setRemoving] = useState<string | null>(null);

  // 날짜에 하한을 두지 않는다. 지난 날짜 항목은 한도(오늘, d]에 애초에 안 들어가서
  // 계산을 흔들지 않고, 잘못 적은 과거를 남겨두는 것보다 적을 수 있는 편이 낫다.
  const spanBroken = repeat === 'span' && (spanEnd === '' || compareDate(date, spanEnd) > 0);
  const canSubmit = name.trim().length > 0 && amount > 0 && date !== '' && !spanBroken;

  const dayOfMonth = date === '' ? 1 : fromISODate(date).getDate();

  function submit() {
    if (!canSubmit) return;
    const schedule: Schedule =
      repeat === 'monthly'
        ? { type: 'monthly', day: dayOfMonth }
        : repeat === 'every'
          ? { type: 'every', days: everyDays, anchor: date }
          : repeat === 'span'
            ? { type: 'span', start: date, end: spanEnd }
            : { type: 'once', date };
    const entry: Entry = {
      id: initial?.id ?? newId(),
      name: name.trim(),
      amount,
      kind,
      schedule,
      ...(repeat === 'span' ? { color } : {}),
    };
    if (initial) onUpdate?.(entry);
    else onAdd?.(entry);
    onClose();
  }

  return (
    <Modal titleId={titleId} onClose={onClose}>
      <ModalHeader
        titleId={titleId}
        badge={day ? formatDate(day.date) : '예정'}
        title={initial ? '수정' : '새로 만들기'}
        onClose={onClose}
      />

      {day && !dayIsPast && (
        <p className="modal__note">
          이 날까지 쓸 수 있는 한도 <b>{formatWon(day.limit)}</b>
        </p>
      )}

      {day && day.items.length > 0 && (
        <ul className="dialog-items">
          {day.items.map((o) => (
            <li key={o.entry.id}>
              <button
                type="button"
                className="dialog-items__name"
                onClick={() => onEdit?.(o.entry)}
                disabled={!onEdit}
              >
                {o.entry.name}
                {o.entry.schedule.type === 'monthly' && <em className="tag">매달</em>}
                {o.entry.schedule.type === 'every' && (
                  <em className="tag">{o.entry.schedule.days}일마다</em>
                )}
                {o.entry.schedule.type === 'span' && <em className="tag">기간</em>}
              </button>
              <span className="dialog-items__right">
                {removing === o.entry.id ? (
                  <>
                    <button
                      type="button"
                      className="tiny-btn tiny-btn--danger"
                      onClick={() => {
                        onRemove(o.entry.id);
                        setRemoving(null);
                      }}
                    >
                      삭제
                    </button>
                    <button
                      type="button"
                      className="tiny-btn"
                      onClick={() => setRemoving(null)}
                    >
                      취소
                    </button>
                  </>
                ) : tweaking?.id === o.entry.id ? (
                  <AmountTweak
                    kind={o.entry.kind}
                    amount={tweaking.amount}
                    onChange={(v) => setTweaking({ id: o.entry.id, amount: v })}
                    onCommit={() => {
                      if (tweaking.amount > 0 && tweaking.amount !== o.entry.amount) {
                        onUpdate?.({ ...o.entry, amount: tweaking.amount });
                      }
                      setTweaking(null);
                    }}
                    onCancel={() => setTweaking(null)}
                  />
                ) : (
                  <button
                    type="button"
                    className={`dialog-items__amount ${o.entry.kind === 'income' ? 'is-income' : 'is-expense'}`}
                    aria-label={`${o.entry.name} 금액 고치기`}
                    onClick={() => setTweaking({ id: o.entry.id, amount: o.entry.amount })}
                    disabled={!onUpdate}
                  >
                    {o.entry.kind === 'income' ? '+' : '−'}
                    {formatWon(o.entry.schedule.type === 'span' ? o.entry.amount : o.amount)}
                    {o.entry.schedule.type === 'span' && <span className="muted"> 기간 전체</span>}
                  </button>
                )}
                {removing !== o.entry.id && (
                  <button
                    type="button"
                    className="icon-btn icon-btn--small icon-btn--danger"
                    aria-label={`${o.entry.name} 삭제`}
                    onClick={() => {
                      setTweaking(null);
                      setRemoving(o.entry.id);
                    }}
                  >
                    ×
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="dialog-row">
          <span className="dialog-row__label">유형</span>
          <div className="chips">
            <KindChip
              label="예상 입금"
              tone="income"
              active={kind === 'income'}
              onClick={() => setKind('income')}
            />
            <KindChip
              label="나갈 돈"
              tone="expense"
              active={kind === 'expense'}
              onClick={() => setKind('expense')}
            />
          </div>
        </div>

        <label className="dialog-row">
          <span className="dialog-row__label">금액</span>
          <MoneyInput value={amount} onChange={setAmount} placeholder="금액 입력" />
        </label>

        <label className="dialog-row">
          <span className="dialog-row__label">{repeat === 'span' ? '시작' : '날짜'}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        <div className="dialog-row">
          <span className="dialog-row__label">반복</span>
          <div className="chips">
            <RepeatChip active={repeat === 'once'} onClick={() => setRepeat('once')}>
              한 번
            </RepeatChip>
            <RepeatChip active={repeat === 'monthly'} onClick={() => setRepeat('monthly')}>
              매달 {dayOfMonth}일
            </RepeatChip>
            <RepeatChip active={repeat === 'every'} onClick={() => setRepeat('every')}>
              {repeat === 'every' ? `${everyDays}일마다` : '며칠마다'}
            </RepeatChip>
            <RepeatChip active={repeat === 'span'} onClick={() => setRepeat('span')}>
              기간
            </RepeatChip>
          </div>
        </div>

        {repeat === 'every' && (
          <div className="dialog-row">
            <span className="dialog-row__label" aria-hidden="true" />
            <span className="every-edit">
              <input
                type="number"
                min={1}
                max={365}
                inputMode="numeric"
                aria-label="반복 주기"
                value={everyDays}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 1 && n <= 365) setEveryDays(n);
                }}
              />
              <span>일마다 · {date || '날짜'}부터</span>
            </span>
          </div>
        )}

        {repeat === 'span' && (
          <>
            <div className="dialog-row">
              <span className="dialog-row__label">끝</span>
              <input
                type="date"
                aria-label="기간 끝"
                value={spanEnd}
                min={date || undefined}
                onChange={(e) => setSpanEnd(e.target.value)}
              />
            </div>
            <div className="dialog-row">
              <span className="dialog-row__label">색</span>
              <div className="chips">
                {SPAN_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`swatch swatch--${c} ${color === c ? 'is-active' : ''}`}
                    aria-pressed={color === c}
                    aria-label={SPAN_COLOR_LABEL[c]}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        <label className="dialog-row">
          <span className="dialog-row__label">내용</span>
          <input
            type="text"
            value={name}
            placeholder={repeat === 'span' ? '예: 생활비' : '내용을 적어보세요…'}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <div className="modal__actions">
          {initial && (
            <button
              type="button"
              className="ghost-btn ghost-btn--danger modal__delete"
              onClick={() => {
                onRemove(initial.id);
                onClose();
              }}
            >
              삭제
            </button>
          )}
          <button type="button" className="ghost-btn" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="solid-btn" disabled={!canSubmit}>
            {initial ? '저장' : '추가'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * 목록의 금액을 그 자리에서 고친다.
 *
 * 금액만 바꾸는 일이 제일 잦은데 그때마다 수정 팝업을 한 번 더 여는 건 과했다.
 * 쓰는 곳은 이 목록 하나뿐이고 저장은 위와 같은 onUpdate를 타므로, 만들고 고치는
 * 경로가 둘로 갈라지지는 않는다.
 */
function AmountTweak({
  kind,
  amount,
  onChange,
  onCommit,
  onCancel,
}: {
  kind: EntryKind;
  amount: number;
  onChange: (value: number) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <span
      className="amount-tweak"
      // 바깥으로 초점이 나가면 그대로 저장한다. ✓를 누른 경우는 초점이 안에 남아 있다.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onCommit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit();
        }
        if (e.key === 'Escape') {
          // Modal도 Esc를 듣는다. 여기서 멈추지 않으면 팝업까지 같이 닫힌다.
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <span className={kind === 'income' ? 'is-income' : 'is-expense'} aria-hidden="true">
        {kind === 'income' ? '+' : '−'}
      </span>
      <MoneyInput value={amount} onChange={onChange} autoFocus aria-label="금액 고치기" />
      {/* 브라우저가 버튼에 초점을 주면 위 onBlur가 안 도니 눌렀을 때도 저장한다. */}
      <button
        type="button"
        className="icon-btn icon-btn--small"
        aria-label="금액 저장"
        onClick={onCommit}
      >
        ✓
      </button>
    </span>
  );
}

/** 스케줄에서 폼의 날짜 칸에 넣을 기준일. */
function startDateOf(schedule: Schedule): ISODate {
  if (schedule.type === 'once') return schedule.date;
  if (schedule.type === 'every') return schedule.anchor;
  if (schedule.type === 'span') return schedule.start;
  return monthlyToDate(schedule.day);
}

/** 매달 N일의 다음 발생일. */
export function monthlyToDate(day: number): ISODate {
  const today = fromISODate(todayISO());
  const candidate = new Date(today.getFullYear(), today.getMonth(), day);
  if (candidate < today) candidate.setMonth(candidate.getMonth() + 1);
  return toISODate(candidate);
}

function RepeatChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`chip ${active ? 'is-active' : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function KindChip({
  label,
  tone,
  active,
  onClick,
}: {
  label: string;
  tone: 'income' | 'expense';
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`chip chip--dot chip--${tone} ${active ? 'is-active' : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="chip__dot" aria-hidden="true" />
      {label}
    </button>
  );
}
