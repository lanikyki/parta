'use client';

import type { Item } from '@/lib/board/types';
import { SHEET } from '@/lib/board/types';
import { bbox } from './geom';

/** Какое меню доски открыто. */
export type Menu = null | 'shapes' | 'bg' | 'pages' | 'more';
export type Box = { x: number; y: number; w: number; h: number };
/** Узкая или низкая доска (телефон, планшет, маленькое окно): панели снизу, в одну строку. */
export const isCompact = (w: number, h: number) => w > 0 && (w < 820 || (h > 0 && h < 420));
/** Невысокий экран ноутбука: инструменты слева в два столбца, иначе нижние кнопки не помещаются. */
export const isTwoCol = (w: number, h: number) => !isCompact(w, h) && h > 0 && h < 680;
/** Края экрана под панелями инструментов: туда ничего не ставим и при «Показать всё» не прячем. */
export const insetsFor = (w: number, h: number) =>
  isCompact(w, h) ? { l: 8, r: 8, t: 56, b: 116 } : { l: isTwoCol(w, h) ? 116 : 72, r: 16, t: 60, b: 70 };
/** Основной лист плюс всё, что нарисовано за его краями. */
export function contentBox(list: Item[], pad: number): Box {
  let [x0, y0, x1, y1] = [0, 0, SHEET.w, SHEET.h];
  for (const it of list) {
    const b = bbox(it);
    if (![b.x, b.y, b.w, b.h].every(Number.isFinite)) continue;
    x0 = Math.min(x0, b.x - pad);
    y0 = Math.min(y0, b.y - pad);
    x1 = Math.max(x1, b.x + b.w + pad);
    y1 = Math.max(y1, b.y + b.h + pad);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function LaserIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="#ff3b45" />
      <circle cx="12" cy="12" r="8" fill="none" stroke="#ff3b45" strokeOpacity=".35" strokeWidth="2" />
    </svg>
  );
}

export function ToolButton({
  active,
  title,
  onClick,
  disabled,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-[11px] transition-colors disabled:opacity-35 ${
        active ? 'bg-brand text-white' : 'text-ink-2 hover:bg-tint hover:text-brand-800'
      }`}
    >
      {children}
    </button>
  );
}
