// Модель доски. Каждый объект хранит версию v: при слиянии побеждает более новая.
export type Pt = [number, number, number]; // x, y, нажим

type Base = { id: string; page: string; v: number; by?: string; deleted?: boolean };

export type StrokeItem = Base & {
  type: 'stroke';
  kind: 'pen' | 'marker' | 'highlighter';
  pts: Pt[];
  color: string;
  size: number;
};
export type ShapeItem = Base & {
  type: 'shape';
  shape: 'line' | 'arrow' | 'rect' | 'ellipse';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  size: number;
};
export type TextItem = Base & { type: 'text'; x: number; y: number; w: number; text: string; color: string; fs: number };
export type ImageItem = Base & { type: 'image'; x: number; y: number; w: number; h: number; src: string; locked?: boolean };
export type GraphItem = Base & {
  type: 'graph';
  x: number;
  y: number;
  w: number;
  h: number;
  exprs: string[];
  range: number;
};

export type Item = StrokeItem | ShapeItem | TextItem | ImageItem | GraphItem;
export type PageBg = 'grid' | 'lines' | 'dots' | 'plain';
export type Page = { id: string; idx: number; bg: PageBg; v: number; deleted?: boolean };
export type BoardSnapshot = { pages: Record<string, Page>; items: Record<string, Item> };

export const SHEET = { w: 1600, h: 1000 };

export const emptyBoard = (): BoardSnapshot => ({
  pages: { p1: { id: 'p1', idx: 0, bg: 'grid', v: 1 } },
  items: {},
});

export function mergeInto(target: BoardSnapshot, patch: Partial<BoardSnapshot>) {
  let changed = false;
  for (const p of Object.values(patch.pages ?? {})) {
    const cur = target.pages[p.id];
    if (!cur || cur.v < p.v) {
      target.pages[p.id] = p;
      changed = true;
    }
  }
  for (const it of Object.values(patch.items ?? {})) {
    const cur = target.items[it.id];
    if (!cur || cur.v < it.v) {
      target.items[it.id] = it;
      changed = true;
    }
  }
  return changed;
}

export const livePages = (s: BoardSnapshot) =>
  Object.values(s.pages)
    .filter((p) => !p.deleted)
    .sort((a, b) => a.idx - b.idx || a.id.localeCompare(b.id));

export function sanitizeSnapshot(raw: unknown): BoardSnapshot {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<BoardSnapshot>;
  const out: BoardSnapshot = { pages: {}, items: {} };
  for (const p of Object.values(s.pages ?? {})) if (p && typeof p.id === 'string' && typeof p.v === 'number') out.pages[p.id] = p;
  for (const it of Object.values(s.items ?? {}))
    if (it && typeof it.id === 'string' && typeof it.v === 'number' && typeof it.page === 'string') out.items[it.id] = it;
  if (!Object.keys(out.pages).length) Object.assign(out.pages, emptyBoard().pages);
  return out;
}
