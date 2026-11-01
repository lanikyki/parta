'use client';

import { SHEET } from '@/lib/board/types';

async function upload(code: string, blob: Blob) {
  const res = await fetch(`/api/lessons/${code}/assets`, { method: 'POST', headers: { 'content-type': blob.type }, body: blob });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || 'Не удалось загрузить файл');
  return out.url as string;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось обработать изображение'))), type, q));

/** Уменьшает картинку до 1600 px по большей стороне и загружает. */
export async function uploadImage(code: string, file: File) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  let blob: Blob = file;
  if (scale < 1 || file.size > 1_500_000 || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    if (file.type !== 'image/png') ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    blob = file.type === 'image/png' && file.size < 4_000_000 ? await toBlob(canvas, 'image/png') : await toBlob(canvas, 'image/jpeg', 0.86);
  }
  bmp.close();
  return { url: await upload(code, blob), w, h };
}

/** Рендерит страницы PDF в картинки и загружает их. */
export async function importPdf(code: string, file: File, onProgress: (done: number, total: number) => void) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const total = Math.min(doc.numPages, 40);
  const pages: { url: string; w: number; h: number }[] = [];
  for (let i = 1; i <= total; i++) {
    onProgress(i - 1, total);
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, SHEET.w / base.width, (SHEET.h * 1.6) / base.height);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
    const blob = await toBlob(canvas, 'image/jpeg', 0.84);
    pages.push({ url: await upload(code, blob), w: canvas.width, h: canvas.height });
    page.cleanup();
  }
  onProgress(total, total);
  await task.destroy();
  return pages;
}

/** Вписывает картинку в лист с отступами. */
export function fitInSheet(w: number, h: number, pad = 24) {
  const s = Math.min((SHEET.w - pad * 2) / w, (SHEET.h - pad * 2) / h);
  const fw = Math.round(w * s);
  const fh = Math.round(h * s);
  return { x: Math.round((SHEET.w - fw) / 2), y: Math.round((SHEET.h - fh) / 2), w: fw, h: fh };
}
