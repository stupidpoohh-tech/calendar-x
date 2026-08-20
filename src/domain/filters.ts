import { LENS_BY_ID } from './constants';
import { displayTitle } from './entry';
import type { ColorId, Entry, Filters, LensId } from './types';

export function emptyFilters(): Filters {
  return {
    colors: new Set<ColorId>(),
    tags: new Set<string>(),
    status: 'all',
    important: false,
    urgent: false,
    q: '',
  };
}

export function hasActiveFilter(f: Filters): boolean {
  return f.colors.size > 0
    || f.tags.size > 0
    || f.status !== 'all'
    || f.important
    || f.urgent
    || f.q.trim().length > 0;
}

/** 렌즈는 kind 에 대한 필터일 뿐이다. 'all' 은 아무것도 거르지 않는다. */
export function matchesLens(e: Entry, lens: LensId): boolean {
  const kind = LENS_BY_ID[lens]?.kind ?? null;
  return kind === null || e.kind === kind;
}

export function matchesFilters(e: Entry, f: Filters): boolean {
  if (f.colors.size > 0 && !f.colors.has(e.color)) return false;

  if (f.tags.size > 0) {
    let hit = false;
    for (const t of e.tags) {
      if (f.tags.has(t)) { hit = true; break; }
    }
    if (!hit) return false;
  }

  // 할 일에만 있는 속성은 할 일에만 적용한다.
  // 'all' 렌즈에서 중요 필터를 켰다고 아이디어와 지출까지 사라지면 안 된다.
  if (e.kind === 'task') {
    if (f.important && !e.task?.important) return false;
    if (f.urgent && !e.task?.urgent) return false;
    if (f.status !== 'all' && e.task?.status !== f.status) return false;
  } else if (f.status !== 'all' || f.important || f.urgent) {
    return false;
  }

  const q = f.q.trim().toLowerCase();
  if (q) {
    const hay = [displayTitle(e), e.title, e.note, e.location, e.tags.join(' ')]
      .filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }

  return true;
}

export function applyFilters(entries: readonly Entry[], lens: LensId, f: Filters): Entry[] {
  return entries.filter((e) => matchesLens(e, lens) && matchesFilters(e, f));
}

export function collectTags(entries: readonly Entry[]): string[] {
  const s = new Set<string>();
  for (const e of entries) for (const t of e.tags) s.add(t);
  return [...s].sort((a, b) => a.localeCompare(b, 'ko'));
}

export function collectColors(entries: readonly Entry[]): Set<ColorId> {
  const s = new Set<ColorId>();
  for (const e of entries) s.add(e.color);
  return s;
}

export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').replace(/\s+/g, ' ').slice(0, 40);
}
