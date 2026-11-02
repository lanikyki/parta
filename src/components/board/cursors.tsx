'use client';

import { useSyncExternalStore } from 'react';
import type { CursorStore } from './sync';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const svgUrl = (svg: string, hot: number, fallback: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hot} ${hot}, ${fallback}`;
const OUTLINE = 'rgba(15,31,26,.6)';

/** Кружок под кончиком ручки: того же цвета и толщины, что и линия, с белой и тёмной обводкой — виден на любом фоне. */
function dot(d: number, fill: string, opacity = 1) {
  const r = d / 2;
  const size = Math.ceil(d + 8) + (Math.ceil(d + 8) % 2);
  const c = size / 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<circle cx="${c}" cy="${c}" r="${r + 2}" fill="#fff" fill-opacity=".9" stroke="${OUTLINE}" stroke-width="1"/>` +
    `<circle cx="${c}" cy="${c}" r="${r}" fill="${fill}" fill-opacity="${opacity}"/>` +
    `</svg>`;
  return svgUrl(svg, c, 'crosshair');
}

/** Крестик для фигур: тёмный с белой каймой, чтобы не терялся на клетках. */
function cross(color: string) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">` +
    `<path d="M12 2v7M12 15v7M2 12h7M15 12h7" stroke="#fff" stroke-width="4" stroke-linecap="round"/>` +
    `<path d="M12 2v7M12 15v7M2 12h7M15 12h7" stroke="#0f1f1a" stroke-width="1.6" stroke-linecap="round"/>` +
    `<circle cx="12" cy="12" r="2.2" fill="${color}" stroke="#fff" stroke-width="1"/>` +
    `</svg>`;
  return svgUrl(svg, 12, 'crosshair');
}

/** Кольцо ластика: показывает, сколько он захватывает. */
function ring(d: number) {
  const size = d + 6;
  const c = size / 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<circle cx="${c}" cy="${c}" r="${d / 2}" fill="#fff" fill-opacity=".75" stroke="#fff" stroke-width="3"/>` +
    `<circle cx="${c}" cy="${c}" r="${d / 2}" fill="none" stroke="${OUTLINE}" stroke-width="1.4"/>` +
    `</svg>`;
  return svgUrl(svg, c, 'cell');
}

/** Свой курсор для выбранного инструмента. size — толщина линии на листе, s — масштаб. */
export function toolCursor(tool: string, o: { color: string; size: number; s: number; canDraw: boolean }) {
  if (tool === 'select') return 'default';
  if (tool === 'hand') return 'grab';
  if (tool === 'laser') return 'none';
  if (!o.canDraw) return 'default';
  if (tool === 'text') return 'text';
  if (tool === 'eraser') return ring(16);
  if (tool === 'shape') return cross(o.color);
  if (tool === 'highlighter') return dot(clamp(o.size * o.s, 8, 24), o.color, 0.55);
  return dot(clamp(o.size * o.s, 5, 22), o.color);
}

/** Курсоры других участников: стрелка их цвета и подпись с именем. */
export function CursorLayer({ store, page, view }: { store: CursorStore; page?: string; view: { s: number; x: number; y: number } }) {
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  const list = [...store.map.entries()].filter(([, c]) => c.page === page);
  if (!list.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden" aria-hidden="true">
      <div className="absolute top-0 left-0" style={{ transform: `translate(${view.x}px, ${view.y}px)` }}>
        {list.map(([id, c]) => (
          <div
            key={id}
            data-cursor={c.name}
            className="absolute top-0 left-0"
            style={{ transform: `translate(${c.x * view.s}px, ${c.y * view.s}px)`, transition: 'transform 90ms linear' }}
          >
            <svg width="22" height="24" viewBox="0 0 22 24" className="-mt-[2px] -ml-[2px] block drop-shadow-[0_1px_2px_rgba(0,0,0,.3)]">
              <path d="M2.5 2v17l4.8-4.6 3.3 7.4 3.4-1.5-3.3-7.2h6.8z" fill={c.c} stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
            <span
              className="absolute top-[20px] left-[13px] max-w-[170px] truncate rounded-full px-2 py-[3px] text-[12px] leading-[15px] font-medium whitespace-nowrap text-white shadow-soft"
              style={{ background: c.c }}
            >
              {c.name || 'Участник'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
