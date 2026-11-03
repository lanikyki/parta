'use client';

import { Copy, Minus, Plus, Trash2 } from 'lucide-react';
import type { Box } from './geom';
import { CORNERS, FRAME_PAD, cornerPt, padBox } from './resize';

/** Пунктирная рамка вокруг выделенного и уголки, за которые объект растягивают или сжимают. */
export function SelectionFrame({ box, k, handles, big }: { box: Box; k: number; handles: boolean; big: boolean }) {
  const f = padBox(box, FRAME_PAD / k);
  const hs = (big ? 16 : 11) / k;
  return (
    <g pointerEvents="none" data-selection="">
      <rect x={f.x} y={f.y} width={f.w} height={f.h} fill="none" stroke="#12a566" strokeWidth={1.5 / k} strokeDasharray={`${6 / k} ${4 / k}`} rx={6 / k} />
      {handles &&
        CORNERS.map((c) => {
          const p = cornerPt(f, c);
          return (
            <rect
              key={c}
              data-handle={c}
              x={p.x - hs / 2}
              y={p.y - hs / 2}
              width={hs}
              height={hs}
              rx={3 / k}
              fill="#fff"
              stroke="#12a566"
              strokeWidth={2 / k}
            />
          );
        })}
    </g>
  );
}

const BTN = 'grid h-8 w-8 place-items-center rounded-full bg-white shadow-soft';

/** Кнопки у выделенного: меньше, больше, копия, удалить. Стоят над объектом, а если там нет места — под ним. */
export function SelectionBar({
  box,
  view,
  area,
  ins,
  locked,
  onScale,
  onDuplicate,
  onDelete,
}: {
  box: Box;
  view: { s: number; x: number; y: number };
  area: { w: number; h: number };
  /** Края экрана под панелями доски. */
  ins: { l: number; r: number; t: number; b: number };
  /** Страница PDF: её не копируем. */
  locked: boolean;
  onScale: (f: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const n = locked ? 3 : 4;
  const w = n * 32 + (n - 1) * 4;
  const k = view.s;
  const above = view.y + box.y * k - FRAME_PAD - 40;
  const below = view.y + (box.y + box.h) * k + FRAME_PAD + 8;
  const top = above >= ins.t ? above : below <= area.h - ins.b - 32 ? below : ins.t;
  const right = view.x + (box.x + box.w) * k + FRAME_PAD;
  const left = Math.max(ins.l, Math.min(right - w, area.w - ins.r - w));
  return (
    <div data-ui className="absolute z-10 flex gap-1" style={{ left, top }}>
      <button
        type="button"
        onClick={() => onScale(1 / 1.25)}
        className={`${BTN} text-ink-2 hover:bg-tint hover:text-brand-800`}
        aria-label="Сделать меньше"
        title="Сделать меньше (−). Или тяните за уголок рамки"
      >
        <Minus size={16} />
      </button>
      <button
        type="button"
        onClick={() => onScale(1.25)}
        className={`${BTN} text-ink-2 hover:bg-tint hover:text-brand-800`}
        aria-label="Сделать больше"
        title="Сделать больше (+). Или тяните за уголок рамки"
      >
        <Plus size={16} />
      </button>
      {!locked && (
        <button type="button" onClick={onDuplicate} className={`${BTN} text-ink-2 hover:bg-tint hover:text-brand-800`} aria-label="Дублировать" title="Дублировать (Ctrl+D)">
          <Copy size={15} />
        </button>
      )}
      <button type="button" onClick={onDelete} className={`${BTN} text-accent-600 hover:bg-accent-soft`} aria-label="Удалить" title="Удалить (Delete)">
        <Trash2 size={16} />
      </button>
    </div>
  );
}
