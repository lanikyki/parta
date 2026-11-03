import type { Item, Pt } from '@/lib/board/types';
import { type Box, type P, r1 } from './geom';

/** Уголки рамки выделенного объекта: за них объект растягивают и сжимают. */
export type Corner = 'nw' | 'ne' | 'sw' | 'se';
export const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];
const OPPOSITE: Record<Corner, Corner> = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' };
export const opposite = (c: Corner) => OPPOSITE[c];
export const cornerCursor = (c: Corner) => (c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize');
export const cornerPt = (b: Box, c: Corner): P => ({ x: c[1] === 'w' ? b.x : b.x + b.w, y: c[0] === 'n' ? b.y : b.y + b.h });
export const padBox = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + d * 2, h: b.h + d * 2 });
/** Рамка выделения на экране шире объекта на столько пикселей. */
export const FRAME_PAD = 6;

/** Какой уголок рамки под точкой экрана pt (r — радиус попадания в пикселях). */
export function cornerAt(box: Box, view: { s: number; x: number; y: number }, pt: P, r: number): Corner | null {
  const f = padBox({ x: view.x + box.x * view.s, y: view.y + box.y * view.s, w: box.w * view.s, h: box.h * view.s }, FRAME_PAD);
  let best: Corner | null = null;
  let bd = r;
  for (const c of CORNERS) {
    const p = cornerPt(f, c);
    const d = Math.hypot(p.x - pt.x, p.y - pt.y);
    if (d <= bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

const MIN_SIDE = 16;
const MAX_SIDE = 12000;
/** Множитель в разумных пределах: объект не становится крошечным или огромным (длинная сторона 16…12000 точек листа). */
export function clampScale(b: Box, k: number) {
  if (!Number.isFinite(k)) return 1;
  const side = Math.max(b.w, b.h, 1);
  return Math.min(Math.max(1, MAX_SIDE / side), Math.max(Math.min(1, MIN_SIDE / side), k));
}

/** Во сколько раз изменить объект, если уголок from утащили в точку p, а противоположный угол anchor стоит на месте. */
export function dragScale(anchor: P, from: P, p: P) {
  const vx = from.x - anchor.x;
  const vy = from.y - anchor.y;
  const d = vx * vx + vy * vy;
  return d ? ((p.x - anchor.x) * vx + (p.y - anchor.y) * vy) / d : 1;
}

/** Увеличить или уменьшить объект в k раз относительно точки (ax, ay), сохраняя пропорции. Толщина линий и размер шрифта меняются вместе с ним. */
export function scaleItem<T extends Item>(it: T, k: number, ax: number, ay: number): T {
  const sx = (x: number) => r1(ax + (x - ax) * k);
  const sy = (y: number) => r1(ay + (y - ay) * k);
  switch (it.type) {
    case 'stroke':
      return { ...it, pts: it.pts.map(([x, y, pr]) => [sx(x), sy(y), pr] as Pt), size: r1(Math.max(0.5, it.size * k)) };
    case 'shape':
      return { ...it, x1: sx(it.x1), y1: sy(it.y1), x2: sx(it.x2), y2: sy(it.y2), size: r1(Math.max(0.5, it.size * k)) };
    case 'text':
      return { ...it, x: sx(it.x), y: sy(it.y), w: r1(Math.max(20, it.w * k)), fs: r1(Math.max(6, it.fs * k)) };
    default:
      return { ...it, x: sx(it.x), y: sy(it.y), w: r1(Math.max(1, it.w * k)), h: r1(Math.max(1, it.h * k)) };
  }
}
