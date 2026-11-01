import type { Item, Pt } from '@/lib/board/types';

export type P = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

export const r1 = (n: number) => Math.round(n * 10) / 10;

/** Примерная высота текстового блока (точная измеряется после отрисовки). */
export const textHeights = new Map<string, number>();
export function textHeight(it: Extract<Item, { type: 'text' }>) {
  const measured = textHeights.get(it.id);
  if (measured) return measured;
  const lines = it.text.split('\n').length;
  const display = (it.text.match(/\$\$/g)?.length ?? 0) / 2;
  return Math.max(it.fs * 1.5, lines * it.fs * 1.45 + display * it.fs * 1.4);
}

export function bbox(it: Item): Box {
  switch (it.type) {
    case 'stroke': {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [x, y] of it.pts) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      const pad = it.size / 2;
      return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    }
    case 'shape': {
      const pad = it.size / 2 + (it.shape === 'arrow' ? it.size * 2 : 0);
      const x = Math.min(it.x1, it.x2);
      const y = Math.min(it.y1, it.y2);
      return { x: x - pad, y: y - pad, w: Math.abs(it.x2 - it.x1) + pad * 2, h: Math.abs(it.y2 - it.y1) + pad * 2 };
    }
    case 'text':
      return { x: it.x, y: it.y, w: it.w, h: textHeight(it) };
    default:
      return { x: it.x, y: it.y, w: it.w, h: it.h };
  }
}

export function distToSeg(p: P, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((p.x - ax) * dx + (p.y - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy));
}

const inBox = (p: P, b: Box, pad = 0) => p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;

/** Попадание точки в объект. mode='erase' — только по линиям, 'select' — по площади. */
export function hit(it: Item, p: P, tol: number, mode: 'select' | 'erase') {
  if (it.type === 'image' && it.locked) return false;
  const b = bbox(it);
  if (!inBox(p, b, tol)) return false;
  if (it.type === 'stroke') {
    const pts = it.pts;
    const lim = it.size / 2 + tol;
    if (pts.length === 1) return Math.hypot(p.x - pts[0][0], p.y - pts[0][1]) <= lim;
    for (let i = 1; i < pts.length; i++) if (distToSeg(p, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= lim) return true;
    return false;
  }
  if (it.type === 'shape') {
    const lim = it.size / 2 + tol;
    if (it.shape === 'line' || it.shape === 'arrow') return distToSeg(p, it.x1, it.y1, it.x2, it.y2) <= lim;
    if (mode === 'select') return true;
    const x1 = Math.min(it.x1, it.x2);
    const x2 = Math.max(it.x1, it.x2);
    const y1 = Math.min(it.y1, it.y2);
    const y2 = Math.max(it.y1, it.y2);
    if (it.shape === 'rect')
      return (
        distToSeg(p, x1, y1, x2, y1) <= lim ||
        distToSeg(p, x2, y1, x2, y2) <= lim ||
        distToSeg(p, x2, y2, x1, y2) <= lim ||
        distToSeg(p, x1, y2, x1, y1) <= lim
      );
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const rx = Math.max(1, (x2 - x1) / 2);
    const ry = Math.max(1, (y2 - y1) / 2);
    const k = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
    return Math.abs(k - 1) * Math.min(rx, ry) <= lim;
  }
  return true;
}

export function translate<T extends Item>(it: T, dx: number, dy: number): T {
  switch (it.type) {
    case 'stroke':
      return { ...it, pts: it.pts.map(([x, y, pr]) => [r1(x + dx), r1(y + dy), pr] as Pt) };
    case 'shape':
      return { ...it, x1: r1(it.x1 + dx), y1: r1(it.y1 + dy), x2: r1(it.x2 + dx), y2: r1(it.y2 + dy) };
    default:
      return { ...it, x: r1((it as { x: number }).x + dx), y: r1((it as { y: number }).y + dy) };
  }
}

/** Сортировка для отрисовки: фон PDF снизу, остальное по времени изменения. */
export const zSort = (a: Item, b: Item) => {
  const la = a.type === 'image' && a.locked ? 0 : 1;
  const lb = b.type === 'image' && b.locked ? 0 : 1;
  return la - lb || a.v - b.v;
};
