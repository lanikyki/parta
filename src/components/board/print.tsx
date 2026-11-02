'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Item, Page } from '@/lib/board/types';
import { r1, zSort } from './geom';
import { IdPrefixProvider, ItemView, PageBackground } from './render';
import { contentBox } from './ui';

/**
 * Печать и сохранение в PDF: рисуем листы целиком в отдельном блоке (на экране он скрыт стилями .board-print)
 * и открываем окно печати. Каждый лист — отдельная страница: основной лист и всё, что нарисовали за его краями.
 */
export function PrintSheets({ pages, items, onDone }: { pages: Page[]; items: Record<string, Item>; onDone: () => void }) {
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    let alive = true;
    const ids = new Set(pages.map((p) => p.id));
    const srcs = [...new Set(Object.values(itemsRef.current).flatMap((i) => (i.type === 'image' && !i.deleted && ids.has(i.page) ? [i.src] : [])))];
    const done = () => alive && doneRef.current();
    (async () => {
      // Ждём картинки и шрифты, иначе в PDF попадут пустые места
      await Promise.all(
        srcs.map(
          (src) =>
            new Promise((r) => {
              const im = new Image();
              im.onload = im.onerror = r;
              im.src = src;
            }),
        ),
      );
      await document.fonts?.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (!alive) return;
      window.addEventListener('afterprint', done, { once: true });
      window.print();
    })();
    return () => {
      alive = false;
      window.removeEventListener('afterprint', done);
    };
  }, [pages]);

  return createPortal(
    <div className="board-print" aria-hidden="true">
      {pages.map((p) => {
        const list = Object.values(items).filter((i) => !i.deleted && i.page === p.id);
        const b = contentBox(list, 16);
        return (
          <IdPrefixProvider key={p.id} value={`print-${p.id}-`}>
            <svg viewBox={`${r1(b.x)} ${r1(b.y)} ${r1(b.w)} ${r1(b.h)}`} className="board-print-sheet" xmlns="http://www.w3.org/2000/svg">
              <PageBackground bg={p.bg} box={b} />
              {list.sort(zSort).map((it) => (
                <ItemView key={it.id} it={it} />
              ))}
            </svg>
          </IdPrefixProvider>
        );
      })}
    </div>,
    document.body,
  );
}
