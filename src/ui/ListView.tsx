import { useMemo, useState } from 'react';
import { colorHex, MONEY_TYPE_BY_ID, STATUS_BY_ID } from '../domain/constants';
import { fmtDayShort, normalizeDate, ymOfDate } from '../domain/date';
import { displayTitle, effectiveEndDate, isDone } from '../domain/entry';
import { formatSigned } from '../domain/money';
import type { Entry, LensId } from '../domain/types';
import { Icon } from './Icon';

interface Props {
  cursor: Date;
  entries: readonly Entry[];
  lens: LensId;
  todayISO: string;
  onEntryClick: (e: Entry) => void;
  onReorder: (dragId: string, overId: string, position: 'before' | 'after') => void;
}

interface Group { date: string; entries: Entry[] }

export function ListView({ cursor, entries, lens, todayISO, onEntryClick, onReorder }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overPos, setOverPos] = useState<'before' | 'after'>('before');

  // 정렬 드래그는 할 일 렌즈에서만 의미가 있다. 다른 렌즈는 날짜순이 유일한 순서다.
  const canReorder = lens === 'task';

  const groups = useMemo<Group[]>(() => {
    const ym = ymOfDate(cursor);
    const inMonth = entries.filter((e) => {
      const start = normalizeDate(e.startDate);
      return start.startsWith(ym) || (effectiveEndDate(e) >= `${ym}-01` && start <= `${ym}-31`);
    });

    const sorted = [...inMonth].sort((a, b) => {
      if (canReorder) {
        const ao = a.task?.order ?? Number.MAX_SAFE_INTEGER;
        const bo = b.task?.order ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
      }
      const key = (e: Entry) => `${normalizeDate(e.startDate)}T${e.startTime ?? '00:00'}`;
      return key(a).localeCompare(key(b));
    });

    const map = new Map<string, Entry[]>();
    for (const e of sorted) {
      const key = normalizeDate(e.startDate) || '미정';
      const bucket = map.get(key);
      if (bucket) bucket.push(e);
      else map.set(key, [e]);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, list]) => ({ date, entries: list }));
  }, [entries, cursor, canReorder]);

  if (groups.length === 0) {
    return (
      <div className="empty">
        <p className="empty-t">이 달에는 아직 항목이 없습니다.</p>
        <p className="empty-s">날짜를 눌러 바로 추가할 수 있습니다.</p>
      </div>
    );
  }

  return (
    <div className="lst">
      {groups.map((g) => (
        <section className="lst-g" key={g.date}>
          <h3 className={'lst-gh' + (g.date === todayISO ? ' today' : '')}>
            {g.date === '미정' ? '날짜 미정' : fmtDayShort(g.date)}
            {g.date === todayISO && <span className="lst-today">오늘</span>}
          </h3>

          <ul className="lst-ul">
            {g.entries.map((e) => {
              const money = e.kind === 'money' ? e.money : null;
              const type = money ? MONEY_TYPE_BY_ID[money.type] : null;
              const dragging = dragId === e.id;
              const over = overId === e.id;
              return (
                <li
                  key={e.id}
                  className={
                    'lst-row'
                    + (dragging ? ' dragging' : '')
                    + (over ? ` over-${overPos}` : '')
                  }
                  draggable={canReorder}
                  onDragStart={(ev) => {
                    if (!canReorder) return;
                    setDragId(e.id);
                    ev.dataTransfer.effectAllowed = 'move';
                    try { ev.dataTransfer.setData('text/plain', e.id); } catch { /* 일부 브라우저 */ }
                  }}
                  onDragOver={(ev) => {
                    if (!canReorder || !dragId) return;
                    ev.preventDefault();
                    const rect = ev.currentTarget.getBoundingClientRect();
                    setOverId(e.id);
                    setOverPos(ev.clientY - rect.top < rect.height / 2 ? 'before' : 'after');
                  }}
                  onDrop={(ev) => {
                    if (!canReorder || !dragId || dragId === e.id) { setDragId(null); setOverId(null); return; }
                    ev.preventDefault();
                    onReorder(dragId, e.id, overPos);
                    setDragId(null); setOverId(null);
                  }}
                  onDragEnd={() => { setDragId(null); setOverId(null); }}
                >
                  <button className="lst-main" onClick={() => onEntryClick(e)}>
                    {canReorder && <span className="lst-grip"><Icon.Grip size={14} /></span>}
                    <span className="lst-bar" style={{ background: type?.color ?? colorHex(e.color) }} />
                    <span className="lst-body">
                      <span className={'lst-title' + (isDone(e) ? ' done' : '')}>
                        {displayTitle(e)}
                        {e.isRecurring && <Icon.Repeat size={11} />}
                      </span>
                      <span className="lst-meta">
                        {lens === 'all' && <span className="lst-kind">{kindLabel(e)}</span>}
                        {e.startTime && <span>{e.startTime}{e.endTime ? `–${e.endTime}` : ''}</span>}
                        {effectiveEndDate(e) > e.startDate && <span>~ {effectiveEndDate(e).slice(5)}</span>}
                        {e.location && <span>@ {e.location}</span>}
                        {e.task && <span className="lst-status"><i style={{ background: STATUS_BY_ID[e.task.status].dot }} />{STATUS_BY_ID[e.task.status].label}</span>}
                        {e.tags.slice(0, 3).map((t) => <span key={t}>#{t}</span>)}
                      </span>
                    </span>
                    <span className="lst-right">
                      {money && type && (
                        <span className={'lst-amt' + (type.sign > 0 ? ' plus' : type.sign < 0 ? ' minus' : '')}>
                          {type.sign === 0 ? formatSigned(money.amountMinor, money.currency).replace(/^[+−]/, '') : formatSigned(type.sign * money.amountMinor, money.currency)}
                        </span>
                      )}
                      {e.task?.urgent && <Icon.Flame size={13} filled fillColor="#ef4444" stroke="#ef4444" />}
                      {e.task?.important && <Icon.Star size={13} filled fillColor="#f59e0b" stroke="#f59e0b" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function kindLabel(e: Entry): string {
  return e.kind === 'task' ? '할 일' : e.kind === 'idea' ? '아이디어' : '가계부';
}
