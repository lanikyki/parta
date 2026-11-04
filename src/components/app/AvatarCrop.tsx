'use client';

import { LoaderCircle, X, ZoomIn } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const OUT = 320; // сторона готового фото, px
const VIEW = 248; // сторона окошка обрезки на экране, px

/** Обрезка фото в квадрат: двигайте пальцем или мышью, приближайте ползунком. Готовое фото — 320×320. */
export function AvatarCrop({ file, onClose, onSaved }: { file: File; onClose: () => void; onSaved: (url: string | null) => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      setImg(im);
      const s = VIEW / Math.min(im.naturalWidth, im.naturalHeight);
      setPos({ x: (VIEW - im.naturalWidth * s) / 2, y: (VIEW - im.naturalHeight * s) / 2 });
    };
    im.onerror = () => setError('Не получилось открыть фото. Выберите картинку в формате JPG или PNG.');
    im.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const base = img ? VIEW / Math.min(img.naturalWidth, img.naturalHeight) : 1;
  const scale = base * zoom;
  const w = img ? img.naturalWidth * scale : VIEW;
  const h = img ? img.naturalHeight * scale : VIEW;
  const clamp = (p: { x: number; y: number }, ww = w, hh = h) => ({ x: Math.min(0, Math.max(VIEW - ww, p.x)), y: Math.min(0, Math.max(VIEW - hh, p.y)) });

  function setZoomAround(z: number) {
    if (!img) return;
    const nz = Math.min(3, Math.max(1, z));
    const ns = base * nz;
    // приближаем к центру окошка
    const cx = (VIEW / 2 - pos.x) / scale;
    const cy = (VIEW / 2 - pos.y) / scale;
    setZoom(nz);
    setPos(clamp({ x: VIEW / 2 - cx * ns, y: VIEW / 2 - cy * ns }, img.naturalWidth * ns, img.naturalHeight * ns));
  }

  async function save() {
    if (!img) return;
    setBusy(true);
    setError('');
    try {
      const c = document.createElement('canvas');
      c.width = OUT;
      c.height = OUT;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      const side = VIEW / scale;
      ctx.drawImage(img, -pos.x / scale, -pos.y / scale, side, side, 0, 0, OUT, OUT);
      const blobOf = (type: string, q: number) => new Promise<Blob | null>((r) => c.toBlob(r, type, q));
      let blob = await blobOf('image/webp', 0.86);
      if (!blob || blob.type !== 'image/webp') blob = await blobOf('image/jpeg', 0.88);
      if (!blob) throw new Error('Не получилось подготовить фото');
      const res = await fetch('/api/me/avatar', { method: 'POST', headers: { 'content-type': blob.type }, body: blob });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Не получилось сохранить фото');
      onSaved(out.avatar ?? null);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/40 p-3 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="crop-title" className="pop-in w-full max-w-[380px] rounded-[24px] bg-white p-5 shadow-lift sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 id="crop-title" className="text-[20px] font-medium">
            Фото профиля
          </h2>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="grid h-9 w-9 place-items-center rounded-full text-ink-3 hover:bg-mist hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <p className="mt-1 text-[14px] text-ink-3">Передвиньте фото, чтобы лицо было в круге.</p>
        <div
          className="relative mx-auto mt-4 touch-none overflow-hidden rounded-2xl bg-mist select-none"
          style={{ width: VIEW, height: VIEW, cursor: img ? 'grab' : 'default' }}
          onPointerDown={(e) => {
            if (!img) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || d.id !== e.pointerId) return;
            setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }));
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onWheel={(e) => setZoomAround(zoom - e.deltaY / 500)}
        >
          {img && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img.src} alt="" draggable={false} className="pointer-events-none absolute max-w-none" style={{ left: pos.x, top: pos.y, width: w, height: h }} />
          )}
          {!img && !error && (
            <span className="absolute inset-0 grid place-items-center text-ink-3">
              <LoaderCircle className="animate-spin" />
            </span>
          )}
          {/* Затемнение вокруг круга */}
          <span className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_200px_rgb(15_31_26/0.45)]" />
        </div>
        <label className="mt-4 flex items-center gap-3 text-ink-3">
          <ZoomIn size={18} />
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            disabled={!img}
            onChange={(e) => setZoomAround(Number(e.target.value))}
            aria-label="Приблизить"
            className="flex-1 accent-[var(--color-brand)]"
          />
        </label>
        {error && <p className="mt-3 rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-line btn-sm" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={!img || busy}>
            {busy && <LoaderCircle size={16} className="animate-spin" />} Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
