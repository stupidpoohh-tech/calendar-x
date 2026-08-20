import { useMemo } from 'react';
import { COLORS, LENS_BY_ID, STATUSES } from '../domain/constants';
import { collectColors, emptyFilters, hasActiveFilter } from '../domain/filters';
import type { ColorId, Entry, Filters, LensId, TaskStatus } from '../domain/types';
import { Icon } from './Icon';

interface Props {
  filters: Filters;
  onChange: (next: Filters) => void;
  entries: readonly Entry[];
  allTags: readonly string[];
  lens: LensId;
  shownCount: number;
}

export function FilterPanel({ filters, onChange, entries, allTags, lens, shownCount }: Props) {
  // 이 렌즈에 실제로 쓰인 색상만 보여 준다. 쓰지 않은 색을 늘어놓을 이유가 없다.
  const usedColors = useMemo(() => {
    const kind = LENS_BY_ID[lens]?.kind ?? null;
    const scoped = kind ? entries.filter((e) => e.kind === kind) : entries;
    const used = collectColors(scoped);
    return COLORS.filter((c) => used.has(c.id));
  }, [entries, lens]);

  const scopedTags = useMemo(() => {
    const kind = LENS_BY_ID[lens]?.kind ?? null;
    if (!kind) return allTags;
    const used = new Set<string>();
    for (const e of entries) if (e.kind === kind) for (const t of e.tags) used.add(t);
    return allTags.filter((t) => used.has(t));
  }, [entries, allTags, lens]);

  const toggle = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  };

  // 할 일 속성 필터는 할 일이 보이는 렌즈에서만 뜬다.
  const showTaskFilters = lens === 'task' || lens === 'all';

  return (
    <section className="filt" aria-label="필터">
      <div className="filt-row">
        <span className="filt-l">검색</span>
        <div className="filt-search">
          <Icon.Search size={13} />
          <input
            value={filters.q}
            placeholder="제목 · 메모 · 장소 · 태그"
            onChange={(e) => onChange({ ...filters, q: e.target.value })}
            aria-label="검색어"
          />
          {filters.q && (
            <button onClick={() => onChange({ ...filters, q: '' })} aria-label="검색어 지우기">
              <Icon.X size={12} />
            </button>
          )}
        </div>
      </div>

      {usedColors.length > 0 && (
        <div className="filt-row">
          <span className="filt-l">색상</span>
          <div className="filt-chips">
            {usedColors.map((c) => (
              <button
                key={c.id}
                className={'chip color' + (filters.colors.has(c.id) ? ' on' : '')}
                style={{ ['--c' as string]: c.hex }}
                onClick={() => onChange({ ...filters, colors: toggle<ColorId>(filters.colors, c.id) })}
                aria-pressed={filters.colors.has(c.id)}
              >
                <span className="chip-dot" />{c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {showTaskFilters && (
        <>
          <div className="filt-row">
            <span className="filt-l">속성</span>
            <div className="filt-chips">
              <button
                className={'chip' + (filters.important ? ' on' : '')}
                onClick={() => onChange({ ...filters, important: !filters.important })}
                aria-pressed={filters.important}
              >
                <Icon.Star size={12} filled={filters.important} fillColor="#f59e0b" stroke="#f59e0b" /> 중요
              </button>
              <button
                className={'chip' + (filters.urgent ? ' on' : '')}
                onClick={() => onChange({ ...filters, urgent: !filters.urgent })}
                aria-pressed={filters.urgent}
              >
                <Icon.Flame size={12} filled={filters.urgent} fillColor="#ef4444" stroke="#ef4444" /> 긴급
              </button>
            </div>
          </div>

          <div className="filt-row">
            <span className="filt-l">상태</span>
            <div className="filt-chips">
              {([{ id: 'all', label: '전체', dot: '' }, ...STATUSES]).map((s) => (
                <button
                  key={s.id}
                  className={'chip' + (filters.status === s.id ? ' on' : '')}
                  onClick={() => onChange({ ...filters, status: s.id as TaskStatus | 'all' })}
                  aria-pressed={filters.status === s.id}
                >
                  {s.dot && <span className="chip-dot" style={{ background: s.dot }} />}
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {lens === 'all' && (filters.important || filters.urgent || filters.status !== 'all') && (
            <p className="filt-note">할 일 속성으로 걸렀으므로 아이디어·가계부 항목은 보이지 않습니다.</p>
          )}
        </>
      )}

      {scopedTags.length > 0 && (
        <div className="filt-row">
          <span className="filt-l">태그</span>
          <div className="filt-chips">
            {scopedTags.map((t) => (
              <button
                key={t}
                className={'chip' + (filters.tags.has(t) ? ' on' : '')}
                onClick={() => onChange({ ...filters, tags: toggle(filters.tags, t) })}
                aria-pressed={filters.tags.has(t)}
              >
                #{t}
              </button>
            ))}
          </div>
        </div>
      )}

      {hasActiveFilter(filters) && (
        <div className="filt-row foot">
          <span className="filt-l" />
          <button className="filt-clear" onClick={() => onChange(emptyFilters())}>필터 초기화</button>
          <span className="filt-count num">{shownCount.toLocaleString('ko-KR')}개 표시</span>
        </div>
      )}
    </section>
  );
}
