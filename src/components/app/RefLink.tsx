'use client';

import { Check, Copy, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { shareOrigin, usePublicOrigin } from '@/lib/publicOrigin';

const TEXT = 'Провожу уроки в «Парте»: видео, доска и ИИ-помощник в браузере. По моей ссылке — скидка 10% на первую оплату.';

/** Реферальная ссылка: показать, скопировать, отправить. */
export function RefLink({ code }: { code: string }) {
  usePublicOrigin();
  const [url, setUrl] = useState(`/r/${code}`);
  const [done, setDone] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    const tick = () => setUrl(`${shareOrigin()}/r/${code}`);
    tick();
    const t = setInterval(tick, 3000);
    setCanShare(typeof navigator.share === 'function');
    return () => clearInterval(t);
  }, [code]);

  async function copy() {
    const u = `${shareOrigin()}/r/${code}`;
    try {
      await navigator.clipboard.writeText(u);
    } catch {
      prompt('Скопируйте ссылку', u);
    }
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  }

  const enc = encodeURIComponent;
  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Ваша ссылка" className="input min-w-0 font-mono text-[15px] sm:flex-1" />
        <button type="button" className="btn btn-primary shrink-0" onClick={copy}>
          {done ? <Check size={18} /> : <Copy size={18} />} {done ? 'Скопировано' : 'Скопировать'}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[14px]">
        <span className="text-ink-3">Отправить:</span>
        <a className="btn btn-line btn-sm" target="_blank" rel="noopener noreferrer" href={`https://t.me/share/url?url=${enc(url)}&text=${enc(TEXT)}`}>
          Telegram
        </a>
        <a className="btn btn-line btn-sm" target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${enc(`${TEXT} ${url}`)}`}>
          WhatsApp
        </a>
        <a className="btn btn-line btn-sm" target="_blank" rel="noopener noreferrer" href={`https://vk.com/share.php?url=${enc(url)}`}>
          ВКонтакте
        </a>
        {canShare && (
          <button type="button" className="btn btn-line btn-sm" onClick={() => navigator.share({ title: 'Парта', text: TEXT, url: `${shareOrigin()}/r/${code}` }).catch(() => {})}>
            <Share2 size={16} /> Ещё
          </button>
        )}
      </div>
    </div>
  );
}
