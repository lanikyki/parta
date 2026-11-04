'use client';

import {
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  FileText,
  LifeBuoy,
  Loader2,
  MessageCircle,
  Paperclip,
  PenSquare,
  SendHorizontal,
  Video,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Contact, Msg, ThreadItem } from '@/lib/messages';
import { renderMarkdown } from '@/lib/mathtext';
import { fileUrl, fmtSize, IMAGE_TYPES, isImage, MAX_FILE, MAX_FILES, msgPreview, type MsgFile } from '@/lib/msgfile';
import { shareOrigin, usePublicOrigin } from '@/lib/publicOrigin';
import { InviteLink } from './InviteLink';
import { UNREAD_EVENT } from './MessagesLink';

type LessonLink = { code: string; title: string; startsAt: string | null };
type Me = { id: string; role: 'tutor' | 'student'; admin: boolean };
type Props = {
  me: Me;
  initialThreads: ThreadItem[];
  contacts: Contact[];
  support: boolean;
  invite: string | null;
  lessons: LessonLink[];
  open: { thread?: string; with?: string; support?: boolean };
  mail: boolean;
};
/** Открытая переписка: уже существующая или новая (с учеником/репетитором или с поддержкой). */
type Sel = { thread: string } | { to: Contact } | { support: true } | null;

const MAX = 2000;
const LIST_POLL = 8000;
const CHAT_POLL = 3000;

/* ───────── Мелочи: время, аватар ───────── */

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
function listTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return hhmm(iso);
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return 'Сегодня';
  if (sameDay(d, y)) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
function lessonWhen(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' })}, ${hhmm(iso)}`;
}

const TINTS = ['bg-tint text-brand-800', 'bg-accent-soft text-accent-600', 'bg-[#fff4cc] text-ink', 'bg-[#e8eefc] text-[#2b4aa0]', 'bg-[#f3e8fc] text-[#6b2fa0]'];
function Avatar({ name, support, src, size = 44 }: { name: string; support?: boolean; src?: string | null; size?: number }) {
  if (src && !support)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-full bg-mist object-cover" style={{ width: size, height: size }} />;
  if (support)
    return (
      <span className="grid shrink-0 place-items-center rounded-full bg-brand text-white" style={{ width: size, height: size }}>
        <LifeBuoy size={size * 0.48} />
      </span>
    );
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className={`grid shrink-0 place-items-center rounded-full font-medium ${TINTS[h % TINTS.length]}`} style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {(name.trim()[0] || '?').toUpperCase()}
    </span>
  );
}

async function api<T>(url: string, data?: unknown): Promise<T> {
  const res = await fetch(url, data === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || 'Нет связи с сайтом, попробуйте ещё раз');
  return out as T;
}

const mergeMsgs = (a: Msg[], b: Msg[]) => {
  const map = new Map(a.map((m) => [m.id, m]));
  for (const m of b) map.set(m.id, m);
  return [...map.values()].sort((x, y) => x.id - y.id);
};

const selKey = (s: Sel, threads: ThreadItem[]) => {
  if (!s) return '';
  if ('to' in s) return `d:${s.to.id}`;
  if ('support' in s) return 's';
  const t = threads.find((x) => x.id === s.thread);
  return t?.kind === 'direct' ? `d:${t.with}` : t?.kind === 'support' ? 's' : `t:${s.thread}`;
};

function initialSel({ open, initialThreads: list, contacts }: Props): Sel {
  if (open.thread && list.some((t) => t.id === open.thread)) return { thread: open.thread };
  if (open.with) {
    const t = list.find((x) => x.kind === 'direct' && x.with === open.with);
    if (t) return { thread: t.id };
    const c = contacts.find((x) => x.id === open.with);
    if (c) return { to: c };
  }
  if (open.support) {
    const t = list.find((x) => x.kind === 'support');
    return t ? { thread: t.id } : { support: true };
  }
  return null;
}

/* ───────── Страница «Сообщения» ───────── */

export function Messenger(props: Props) {
  const { me, contacts, support, invite, lessons, mail } = props;
  const [threads, setThreads] = useState(props.initialThreads);
  const [sel, setSel] = useState<Sel>(() => initialSel(props));
  const [picker, setPicker] = useState(false);
  const openId = sel && 'thread' in sel ? sel.thread : null;
  const openRef = useRef(openId);
  openRef.current = openId;

  // На компьютере сразу открываем последнюю переписку
  useEffect(() => {
    if (!sel && threads[0] && window.matchMedia('(min-width: 1024px)').matches) setSel({ thread: threads[0].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Адрес страницы запоминает открытую переписку (можно обновить страницу или отправить ссылку себе)
  useEffect(() => {
    const qs = !sel ? '' : 'thread' in sel ? `?t=${sel.thread}` : 'to' in sel ? `?with=${sel.to.id}` : '?support=1';
    if (location.search !== qs) history.replaceState(history.state, '', `/messages${qs}`);
  }, [sel]);

  // Счётчик непрочитанных в шапке
  useEffect(() => {
    const n = threads.reduce((s, t) => s + (t.id === openId ? 0 : t.unread), 0);
    window.dispatchEvent(new CustomEvent(UNREAD_EVENT, { detail: n }));
  }, [threads, openId]);

  const refresh = useCallback(async () => {
    try {
      const out = await api<{ threads: ThreadItem[] }>('/api/messages');
      setThreads(out.threads.map((t) => (t.id === openRef.current ? { ...t, unread: 0 } : t)));
    } catch {}
  }, []);

  useEffect(() => {
    const id = setInterval(() => !document.hidden && refresh(), LIST_POLL);
    const onShow = () => !document.hidden && refresh();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [refresh]);

  const markRead = useCallback(
    (id: string) => setThreads((list) => (list.some((t) => t.id === id && t.unread) ? list.map((t) => (t.id === id ? { ...t, unread: 0 } : t)) : list)),
    [],
  );

  // Собеседник прочитал моё последнее сообщение — две галочки и в списке, не дожидаясь его обновления
  const markSeen = useCallback(
    (id: string) =>
      setThreads((list) => (list.some((t) => t.id === id && t.lastMine && !t.lastRead) ? list.map((t) => (t.id === id ? { ...t, lastRead: true } : t)) : list)),
    [],
  );

  const current = openId ? threads.find((t) => t.id === openId) : undefined;
  const header = useMemo(() => {
    if (!sel) return null;
    if ('to' in sel) return { name: sel.to.name, sub: sel.to.sub, kind: 'direct' as const, avatar: sel.to.avatar };
    if ('support' in sel) return { name: 'Поддержка', sub: 'Вопросы по сайту — ответят администраторы', kind: 'support' as const, avatar: null };
    return current ? { name: current.name, sub: current.sub, kind: current.kind, avatar: current.avatar } : { name: '…', sub: '', kind: 'direct' as const, avatar: null };
  }, [sel, current]);

  const onSent = useCallback(
    (threadId: string, m: Msg) => {
      setThreads((list) => {
        const old = list.find((t) => t.id === threadId);
        const base: ThreadItem = old ?? {
          id: threadId,
          kind: sel && 'support' in sel ? 'support' : 'direct',
          with: sel && 'to' in sel ? sel.to.id : null,
          name: header?.name || '',
          sub: header?.sub || '',
          lastText: '',
          lastMine: true,
          lastRead: false,
          lastAt: m.at,
          unread: 0,
          avatar: header?.avatar ?? null,
        };
        const lastText = msgPreview(m.text, m.files).slice(0, 200);
        return [{ ...base, lastText, lastMine: true, lastRead: false, lastAt: m.at, unread: 0 }, ...list.filter((t) => t.id !== threadId)];
      });
      if (!openRef.current) setSel({ thread: threadId });
    },
    [sel, header],
  );

  const choose = (s: Sel) => {
    setPicker(false);
    if (s && 'to' in s) {
      const t = threads.find((x) => x.kind === 'direct' && x.with === s.to.id);
      return setSel(t ? { thread: t.id } : s);
    }
    if (s && 'support' in s) {
      const t = threads.find((x) => x.kind === 'support');
      return setSel(t ? { thread: t.id } : s);
    }
    setSel(s);
  };

  const hasSupport = threads.some((t) => t.kind === 'support');
  const key = selKey(sel, threads);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-white sm:rounded-[20px] sm:border sm:border-line">
      {/* Список переписок */}
      <aside className={`flex min-h-0 w-full flex-col lg:w-[340px] lg:shrink-0 lg:border-r lg:border-line ${sel ? 'max-lg:hidden' : ''}`}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h1 className="text-xl font-medium">Сообщения</h1>
          <button type="button" className="btn btn-soft btn-sm" onClick={() => setPicker(true)}>
            <PenSquare size={16} /> Написать
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {threads.length ? (
            <ul>
              {threads.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSel({ thread: t.id })}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${t.id === openId ? 'bg-tint/70' : 'hover:bg-mist'}`}
                  >
                    <Avatar name={t.name} support={t.kind === 'support'} src={t.avatar} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <b className="truncate font-medium">{t.name}</b>
                        {t.kind === 'inbox' && <span className="shrink-0 rounded-full bg-[#fff4cc] px-2 text-[12px] text-ink">поддержка</span>}
                        <span className="ml-auto flex shrink-0 items-center gap-1 text-[12px] text-ink-3" suppressHydrationWarning>
                          {t.lastMine &&
                            (t.lastRead ? (
                              <CheckCheck size={15} className="text-brand-700" aria-label="Прочитано" />
                            ) : (
                              <Check size={15} aria-label="Не прочитано" />
                            ))}
                          {listTime(t.lastAt)}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className={`truncate text-[14px] ${t.unread ? 'font-medium text-ink' : 'text-ink-2'}`}>
                          {t.lastMine && <span className="text-ink-3">Вы: </span>}
                          {t.lastText || 'Нет сообщений'}
                        </span>
                        {t.unread > 0 && t.id !== openId && (
                          <span className="ml-auto grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand px-1.5 text-[12px] leading-none font-medium text-white">
                            {t.unread}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyList me={me} invite={invite} contacts={contacts} onWrite={() => setPicker(true)} />
          )}
        </div>
        {support && !hasSupport && !me.admin && (
          <button
            type="button"
            onClick={() => choose({ support: true })}
            className="flex items-center gap-3 border-t border-line px-4 py-3 text-left text-[15px] text-ink-2 transition-colors hover:bg-mist hover:text-ink"
          >
            <LifeBuoy size={18} className="shrink-0 text-brand-700" />
            Вопрос по сайту? Напишите в поддержку
          </button>
        )}
      </aside>

      {/* Переписка */}
      <section className={`flex min-h-0 min-w-0 flex-1 flex-col ${sel ? '' : 'max-lg:hidden'}`}>
        {sel && header ? (
          <Chat
            key={key}
            threadId={openId}
            target={'to' in sel ? { to: sel.to.id } : 'support' in sel ? { support: true } : {}}
            name={header.name}
            sub={header.sub}
            kind={header.kind}
            avatar={header.avatar}
            me={me}
            lessons={me.role === 'tutor' ? lessons : []}
            mail={mail}
            onBack={() => setSel(null)}
            onSent={onSent}
            onRead={markRead}
            onSeen={markSeen}
          />
        ) : (
          <div className="grid flex-1 place-items-center bg-mist/50 p-8 text-center text-ink-2">
            <div>
              <MessageCircle size={40} className="mx-auto text-brand-700/40" />
              <p className="mt-3">{threads.length ? 'Выберите переписку слева' : 'Здесь появятся ваши переписки'}</p>
            </div>
          </div>
        )}
      </section>

      {picker && <Picker me={me} contacts={contacts} support={support} invite={invite} onClose={() => setPicker(false)} onChoose={choose} />}
    </div>
  );
}

function EmptyList({ me, invite, contacts, onWrite }: { me: Me; invite: string | null; contacts: Contact[]; onWrite: () => void }) {
  const tutor = me.role === 'tutor';
  return (
    <div className="grid gap-4 p-6 text-[15px] text-ink-2">
      <MessageCircle size={36} className="text-brand-700/40" />
      {contacts.length > 0 ? (
        <p>
          <b className="block text-[17px] font-medium text-ink">Переписок пока нет</b>
          {tutor
            ? 'Напишите ученику — например, отправьте ссылку на ближайший урок.'
            : 'Напишите репетитору — например, договоритесь о времени урока.'}
        </p>
      ) : tutor ? (
        <>
          <p>
            <b className="block text-[17px] font-medium text-ink">Здесь будет переписка с учениками</b>
            Ученик появится после первого урока с вами или когда зарегистрируется по вашей ссылке-приглашению.
          </p>
          {invite && <InviteLink code={invite} />}
        </>
      ) : (
        <p>
          <b className="block text-[17px] font-medium text-ink">Здесь будет переписка с репетиторами</b>
          Репетитор появится после первого урока с ним или когда вы перейдёте по его ссылке-приглашению.
        </p>
      )}
      {contacts.length > 0 && (
        <button type="button" className="btn btn-primary" onClick={onWrite}>
          <PenSquare size={17} /> Написать {me.role === 'tutor' ? 'ученику' : 'репетитору'}
        </button>
      )}
    </div>
  );
}

/* ───────── Выбор, кому написать ───────── */

function Picker({
  me,
  contacts,
  support,
  invite,
  onClose,
  onChoose,
}: {
  me: Me;
  contacts: Contact[];
  support: boolean;
  invite: string | null;
  onClose: () => void;
  onChoose: (s: Sel) => void;
}) {
  const [query, setQuery] = useState('');
  const list = contacts.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-ink/30 sm:place-items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Кому написать"
        className="flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-[24px] bg-white shadow-lift sm:max-w-[440px] sm:rounded-[24px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-lg font-medium">Кому написать</h2>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-[10px] text-ink-2 hover:bg-mist" aria-label="Закрыть">
            <X size={19} />
          </button>
        </div>
        {contacts.length > 6 && (
          <div className="border-b border-line px-5 py-3">
            <input className="input h-11" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по имени" autoFocus aria-label="Поиск по имени" />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {list.map((c) => (
            <button key={c.id} type="button" onClick={() => onChoose({ to: c })} className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-mist">
              <Avatar name={c.name} src={c.avatar} size={40} />
              <span className="min-w-0">
                <b className="block truncate font-medium">{c.name}</b>
                <span className="block truncate text-[13px] text-ink-3">{c.sub}</span>
              </span>
            </button>
          ))}
          {!contacts.length && (
            <div className="grid gap-3 px-5 py-3 text-[15px] text-ink-2">
              {me.role === 'tutor' ? (
                <>
                  <p>Учеников пока нет. Ученик появится после первого урока с вами или когда зарегистрируется по вашей ссылке-приглашению.</p>
                  {invite && <InviteLink code={invite} />}
                </>
              ) : (
                <p>Репетиторов пока нет. Репетитор появится после первого урока с ним или когда вы перейдёте по его ссылке-приглашению.</p>
              )}
            </div>
          )}
          {contacts.length > 0 && !list.length && <p className="px-5 py-3 text-[15px] text-ink-2">Никого не нашли.</p>}
          {support && !me.admin && (
            <button type="button" onClick={() => onChoose({ support: true })} className="mt-1 flex w-full items-center gap-3 border-t border-line px-5 py-3 text-left hover:bg-mist">
              <Avatar name="" support size={40} />
              <span className="min-w-0">
                <b className="block font-medium">Поддержка</b>
                <span className="block text-[13px] text-ink-3">Вопросы и проблемы с сайтом</span>
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────── Окно переписки ───────── */

const mdCache = new Map<number, string>();
const html = (m: Msg) => {
  let h = mdCache.get(m.id);
  if (h === undefined) {
    h = renderMarkdown(m.text);
    if (mdCache.size > 3000) mdCache.clear();
    mdCache.set(m.id, h);
  }
  return h;
};

/* ───────── Файлы: загрузка, вставка из буфера, уменьшение фото ───────── */

/** Файл в поле ввода: ещё загружается, уже загружен (file) или не загрузился (error). */
type Att = { key: number; name: string; size: number; image: boolean; url?: string; progress: number; file?: MsgFile; error?: string };
type Job = { done: Promise<MsgFile | null>; xhr?: XMLHttpRequest };
type Sending = { text: string; atts: Att[] };
type Viewing = { files: MsgFile[]; index: number };

let attSeq = 0;
// Форматы фото с телефона, которые браузер умеет открыть, но не все умеют показать, — переводим в JPEG
const CONVERT = /^image\/(heic|heif|avif|bmp|x-ms-bmp|tiff)$/;
const MAX_SIDE = 2560;

/** Файлы из буфера обмена (Ctrl+V). Если там есть текст — это обычная вставка текста (Word и Excel кладут рядом ещё и картинку). */
function clipboardFiles(dt: DataTransfer | null) {
  if (!dt || dt.getData('text/plain').trim()) return [];
  const files = [...dt.files];
  if (files.length) return files;
  return [...dt.items]
    .filter((i) => i.kind === 'file')
    .map((i) => i.getAsFile())
    .filter((f): f is File => Boolean(f));
}

/** Большие фото уменьшаем прямо в браузере (до 2560 точек по большей стороне): уходят быстрее и не упираются в 10 МБ. */
async function prepareImage(file: File, force: boolean): Promise<{ blob: Blob; name: string; w: number; h: number }> {
  const bmp = await createImageBitmap(file);
  const w0 = bmp.width;
  const h0 = bmp.height;
  try {
    const keep = { blob: file as Blob, name: file.name, w: w0, h: h0 };
    if (!force && (file.type === 'image/gif' || (Math.max(w0, h0) <= MAX_SIDE && file.size <= 2_500_000))) return keep;
    const k = Math.min(1, MAX_SIDE / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k));
    const h = Math.max(1, Math.round(h0 * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return keep;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
    if (!blob || (!force && blob.size >= file.size && file.size <= MAX_FILE)) return keep;
    return { blob, name: `${file.name.replace(/\.[a-z0-9]{1,5}$/i, '') || 'Фото'}.jpg`, w, h };
  } finally {
    bmp.close();
  }
}

/** Загрузка одного файла с процентами (fetch пока не умеет показывать прогресс отправки). */
function uploadFile(blob: Blob, name: string, size: { w: number; h: number } | null, job: Job, onProgress: (p: number) => void) {
  return new Promise<MsgFile>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    job.xhr = xhr;
    xhr.open('POST', '/api/messages/files');
    xhr.setRequestHeader('content-type', blob.type || 'application/octet-stream');
    xhr.setRequestHeader('x-file-name', encodeURIComponent(name));
    if (size) xhr.setRequestHeader('x-image-size', `${size.w}x${size.h}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let out: { file?: MsgFile; error?: string } = {};
      try {
        out = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && out.file) resolve(out.file);
      else reject(new Error(out.error || (xhr.status === 413 ? 'Файл больше 10 МБ' : 'Не удалось загрузить файл')));
    };
    xhr.onerror = () => reject(new Error('Нет связи с сайтом — файл не загрузился'));
    xhr.onabort = () => reject(new Error('Загрузка отменена'));
    xhr.send(blob);
  });
}

function readWhen(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return `в ${hhmm(iso)}`;
  if (sameDay(d, y)) return `вчера в ${hhmm(iso)}`;
  return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} в ${hhmm(iso)}`;
}

/** Размер одной фотографии в переписке: не шире 300 и не выше 340 точек. */
function photoBox(f: MsgFile) {
  if (!f.w || !f.h) return undefined;
  const k = Math.min(1, 300 / f.w, 340 / f.h);
  return { width: Math.max(80, Math.round(f.w * k)), aspectRatio: `${f.w} / ${f.h}` };
}

/** Фото и файлы внутри сообщения. */
function Attachments({ files, mine, local, onOpen }: { files: MsgFile[]; mine: boolean; local: Map<string, string>; onOpen: (v: Viewing) => void }) {
  const images = files.filter(isImage);
  const docs = files.filter((f) => !isImage(f));
  return (
    <div className="grid gap-1">
      {images.length > 0 && (
        <div className={images.length === 1 ? '' : 'grid w-[300px] max-w-full grid-cols-2 gap-1'}>
          {images.map((f, i) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onOpen({ files: images, index: i })}
              className={`block overflow-hidden rounded-[14px] ${mine ? 'bg-white/15' : 'bg-mist'} ${images.length > 2 && images.length % 2 && i === 0 ? 'col-span-2' : ''}`}
              aria-label={`Открыть фото ${f.name}`}
              title={f.name}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={local.get(f.id) ?? fileUrl(f)}
                alt={f.name}
                loading="lazy"
                decoding="async"
                className={
                  images.length === 1
                    ? `block h-auto max-w-full ${f.w && f.h ? '' : 'max-h-[340px] w-auto'} object-cover`
                    : `block w-full object-cover ${images.length > 2 && images.length % 2 && i === 0 ? 'aspect-[2/1]' : 'aspect-square'}`
                }
                style={images.length === 1 ? photoBox(f) : undefined}
              />
            </button>
          ))}
        </div>
      )}
      {docs.map((f) => (
        <a
          key={f.id}
          href={fileUrl(f, true)}
          download={f.name}
          className={`flex min-w-0 items-center gap-2.5 rounded-[14px] px-2.5 py-2 transition-colors sm:min-w-[240px] ${
            mine ? 'bg-white/15 hover:bg-white/25' : 'bg-mist hover:bg-tint'
          }`}
          title={`Скачать ${f.name}`}
        >
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[10px] ${mine ? 'bg-white text-brand-700' : 'bg-white text-brand-700 shadow-[inset_0_0_0_1px_var(--color-line)]'}`}>
            <FileText size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium">{f.name}</span>
            <span className={`block text-[12px] ${mine ? 'text-white/75' : 'text-ink-3'}`}>{fmtSize(f.size)}</span>
          </span>
          <Download size={18} className={`shrink-0 ${mine ? 'text-white/80' : 'text-ink-3'}`} />
        </a>
      ))}
    </div>
  );
}

/** Просмотр фото на весь экран: стрелки — листать, Esc — закрыть. */
function Viewer({ view, local, onClose }: { view: Viewing; local: Map<string, string>; onClose: () => void }) {
  const [i, setI] = useState(view.index);
  const n = view.files.length;
  const f = view.files[Math.min(i, n - 1)];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') setI((v) => (v + n - 1) % n);
      else if (e.key === 'ArrowRight') setI((v) => (v + 1) % n);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [n, onClose]);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#0b0f14]/92 text-white" role="dialog" aria-modal="true" aria-label="Просмотр фото" onClick={onClose}>
      <div className="flex items-center gap-2 px-3 py-2.5 sm:px-5" onClick={stop}>
        <span className="min-w-0 flex-1 truncate text-[14px] text-white/85">
          {n > 1 && <b className="mr-2 font-medium text-white">{`${i + 1} из ${n}`}</b>}
          {f.name} · {fmtSize(f.size)}
        </span>
        <a href={fileUrl(f, true)} download={f.name} className="flex h-10 items-center gap-2 rounded-[10px] px-3 text-[15px] hover:bg-white/10">
          <Download size={18} /> <span className="max-sm:hidden">Скачать</span>
        </a>
        <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-[10px] hover:bg-white/10" aria-label="Закрыть">
          <X size={20} />
        </button>
      </div>
      <div className="relative grid min-h-0 flex-1 place-items-center px-2 pb-4 sm:px-16">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={local.get(f.id) ?? fileUrl(f)} alt={f.name} className="max-h-full max-w-full rounded-md object-contain" onClick={stop} />
        {n > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => {
                stop(e);
                setI((v) => (v + n - 1) % n);
              }}
              className="absolute top-1/2 left-2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-white/20"
              aria-label="Предыдущее фото"
            >
              <ChevronLeft size={24} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                stop(e);
                setI((v) => (v + 1) % n);
              }}
              className="absolute top-1/2 right-2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-white/20"
              aria-label="Следующее фото"
            >
              <ChevronRight size={24} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Chat({
  threadId,
  target,
  name,
  sub,
  kind,
  avatar,
  me,
  lessons,
  mail,
  onBack,
  onSent,
  onRead,
  onSeen,
}: {
  threadId: string | null;
  target: { to?: string; support?: boolean };
  name: string;
  sub: string;
  kind: ThreadItem['kind'];
  avatar: string | null;
  me: Me;
  lessons: LessonLink[];
  mail: boolean;
  onBack: () => void;
  onSent: (threadId: string, m: Msg) => void;
  onRead: (threadId: string) => void;
  onSeen: (threadId: string) => void;
}) {
  usePublicOrigin();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [seen, setSeen] = useState(0);
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(Boolean(threadId));
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState('');
  const [atts, setAtts] = useState<Att[]>([]);
  const [sending, setSending] = useState<Sending | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<Viewing | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  const restore = useRef<{ h: number; top: number } | null>(null);
  const lastId = useRef(0);
  const busy = useRef(false);
  const drag = useRef(0);
  const jobs = useRef(new Map<number, Job>());
  // Только что отправленные фото показываем из памяти браузера — без повторной загрузки с сайта
  const local = useRef(new Map<string, string>());
  const attsRef = useRef(atts);
  attsRef.current = atts;
  lastId.current = msgs.length ? msgs[msgs.length - 1].id : 0;

  // Первая загрузка: последние 100 сообщений
  useEffect(() => {
    if (!threadId || lastId.current) return;
    let alive = true;
    setLoading(true);
    api<{ messages: Msg[]; seen: number; seenAt: string | null; more: boolean }>(`/api/messages/${threadId}`)
      .then((out) => {
        if (!alive) return;
        stick.current = true;
        setMsgs((m) => mergeMsgs(m, out.messages));
        setSeen(out.seen);
        setSeenAt(out.seenAt);
        setMore(out.more);
        setLoadError('');
        onRead(threadId);
      })
      .catch((e) => alive && setLoadError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [threadId, onRead]);

  // Новые сообщения и отметки «прочитано» — раз в 3 секунды, пока вкладка открыта
  useEffect(() => {
    if (!threadId) return;
    const tick = async () => {
      if (document.hidden || busy.current || !lastId.current) return;
      try {
        const out = await api<{ messages: Msg[]; seen: number; seenAt: string | null }>(`/api/messages/${threadId}?after=${lastId.current}`);
        setSeen(out.seen);
        setSeenAt(out.seenAt);
        if (out.messages.length) {
          setMsgs((m) => mergeMsgs(m, out.messages));
          if (out.messages.some((m) => !m.mine)) onRead(threadId);
        }
      } catch {}
    };
    const id = setInterval(tick, CHAT_POLL);
    return () => clearInterval(id);
  }, [threadId, onRead]);

  // Прокрутка: вниз при новых сообщениях (если человек и так внизу), на месте — при загрузке истории
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (restore.current) {
      el.scrollTop = el.scrollHeight - restore.current.h + restore.current.top;
      restore.current = null;
    } else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs, sending]);

  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
  }, []);

  const tail = msgs[msgs.length - 1];
  useEffect(() => {
    if (threadId && tail?.mine && tail.id <= seen) onSeen(threadId);
  }, [threadId, tail, seen, onSeen]);

  // Уходим из переписки — останавливаем загрузки и освобождаем память под превью
  useEffect(() => {
    const all = jobs.current;
    const urls = local.current;
    return () => {
      for (const j of all.values()) j.xhr?.abort();
      for (const a of attsRef.current) if (a.url) URL.revokeObjectURL(a.url);
      for (const u of urls.values()) URL.revokeObjectURL(u);
    };
  }, []);

  const loadEarlier = async () => {
    if (!threadId || !msgs.length) return;
    const el = scrollRef.current;
    try {
      const out = await api<{ messages: Msg[]; more: boolean }>(`/api/messages/${threadId}?before=${msgs[0].id}`);
      if (el) restore.current = { h: el.scrollHeight, top: el.scrollTop };
      setMsgs((m) => mergeMsgs(out.messages, m));
      setMore(out.more);
    } catch {}
  };

  const grow = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };
  useEffect(grow, [draft]);

  const patch = (key: number, p: Partial<Att>) => setAtts((list) => list.map((a) => (a.key === key ? { ...a, ...p } : a)));

  /** Прикрепить файлы (скрепка, перетаскивание, Ctrl+V): сразу начинаем загружать, пока человек пишет текст. */
  function addFiles(list: File[]) {
    if (!list.length) return;
    const room = MAX_FILES - attsRef.current.length;
    const problems: string[] = [];
    if (list.length > room) problems.push(`В одном сообщении — не больше ${MAX_FILES} файлов`);
    const added: Att[] = [];
    for (const file of list.slice(0, Math.max(0, room))) {
      const image = IMAGE_TYPES.includes(file.type) || CONVERT.test(file.type);
      if (!file.size) {
        problems.push(`«${file.name}» — пустой файл`);
        continue;
      }
      if (file.size > MAX_FILE && !image) {
        problems.push(`«${file.name}» больше 10 МБ — такой файл не отправить`);
        continue;
      }
      const att: Att = { key: ++attSeq, name: file.name || 'Файл', size: file.size, image, url: image ? URL.createObjectURL(file) : undefined, progress: 0 };
      const job: Job = { done: Promise.resolve(null) };
      job.done = (async () => {
        try {
          let blob: Blob = file;
          let fname = att.name;
          let dims: { w: number; h: number } | null = null;
          if (image) {
            try {
              const p = await prepareImage(file, CONVERT.test(file.type));
              blob = p.blob;
              fname = p.name;
              dims = { w: p.w, h: p.h };
              if (blob !== file) patch(att.key, { size: blob.size, name: fname });
            } catch {
              // Браузер не смог открыть картинку — отправим как обычный файл
            }
          }
          if (blob.size > MAX_FILE) throw new Error('Файл больше 10 МБ');
          const f = await uploadFile(blob, fname, dims, job, (p) => patch(att.key, { progress: p }));
          patch(att.key, { file: f, progress: 1 });
          return f;
        } catch (e) {
          const why = (e as Error).message;
          if (why !== 'Загрузка отменена') {
            patch(att.key, { error: why });
            setError(`Не удалось загрузить «${att.name}»: ${why}`);
          }
          return null;
        }
      })();
      jobs.current.set(att.key, job);
      added.push(att);
    }
    if (added.length) setAtts((cur) => [...cur, ...added]);
    setError(problems.join('. '));
    inputRef.current?.focus();
  }
  const addRef = useRef(addFiles);
  addRef.current = addFiles;

  function removeAtt(key: number) {
    const a = attsRef.current.find((x) => x.key === key);
    jobs.current.get(key)?.xhr?.abort();
    jobs.current.delete(key);
    if (a?.url) URL.revokeObjectURL(a.url);
    setAtts((list) => list.filter((x) => x.key !== key));
    setError('');
  }

  // Ctrl+V с картинкой или файлом — в любом месте переписки (не только в поле ввода)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && t !== inputRef.current && t.closest('input, textarea, [contenteditable="true"], [role="dialog"]')) return;
      const files = clipboardFiles(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      addRef.current(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  const withFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes('Files');

  async function send() {
    const text = draft.trim();
    const list = attsRef.current;
    if ((!text && !list.length) || sending) return;
    if (list.some((a) => a.error)) {
      setError('Уберите файлы, которые не загрузились (красные), и прикрепите их ещё раз');
      return;
    }
    setError('');
    setSending({ text, atts: list });
    setDraft('');
    setAtts([]);
    stick.current = true;
    busy.current = true;
    let files: (MsgFile | null)[] = [];
    try {
      files = await Promise.all(list.map((a) => jobs.current.get(a.key)?.done ?? Promise.resolve(a.file ?? null)));
      if (files.some((f) => !f)) throw new Error('Не все файлы загрузились — прикрепите их ещё раз');
      const ids = files.map((f) => f!.id);
      const out = await api<{ id?: string; message: Msg }>(
        threadId ? `/api/messages/${threadId}` : '/api/messages',
        threadId ? { text, files: ids } : { ...target, text, files: ids },
      );
      list.forEach((a, i) => {
        jobs.current.delete(a.key);
        if (a.url) local.current.set(files[i]!.id, a.url);
      });
      setMsgs((m) => mergeMsgs(m, [out.message]));
      onSent(out.id || threadId || '', out.message);
    } catch (e) {
      setError((e as Error).message);
      setDraft((d) => d || text);
      // Возвращаем файлы в поле ввода: загруженные можно отправить ещё раз
      setAtts((cur) => [
        ...list.map((a, i) => (files[i] ? { ...a, file: files[i]!, progress: 1, error: undefined } : files.length ? { ...a, error: a.error || 'Не загрузился' } : a)),
        ...cur,
      ]);
    } finally {
      setSending(null);
      busy.current = false;
      inputRef.current?.focus();
    }
  }

  const insertLesson = (l: LessonLink) => {
    const when = lessonWhen(l.startsAt);
    const line = `Урок «${l.title}»${when ? `, ${when}` : ''}: ${shareOrigin()}/lesson/${l.code}`;
    setDraft((d) => (d.trim() ? `${d.trimEnd()}\n${line}` : line));
    inputRef.current?.focus();
  };

  const lastMine = [...msgs].reverse().find((m) => m.mine);
  const groupNames = kind !== 'direct';
  const uploading = atts.some((a) => !a.file && !a.error);
  const closeView = useCallback(() => setView(null), []);

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      onDragEnter={(e) => {
        if (!withFiles(e)) return;
        e.preventDefault();
        drag.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!withFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!withFiles(e)) return;
        drag.current = Math.max(0, drag.current - 1);
        if (!drag.current) setDragging(false);
      }}
      onDrop={(e) => {
        if (!withFiles(e)) return;
        e.preventDefault();
        drag.current = 0;
        setDragging(false);
        addFiles([...e.dataTransfer.files]);
      }}
    >
      <div className="flex items-center gap-3 border-b border-line px-2 py-2.5 sm:px-4">
        <button type="button" onClick={onBack} className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] text-ink-2 hover:bg-mist lg:hidden" aria-label="К списку переписок">
          <ArrowLeft size={20} />
        </button>
        <Avatar name={name} support={kind === 'support'} src={avatar} size={40} />
        <span className="min-w-0">
          <b className="block truncate font-medium">{name}</b>
          <span className="block truncate text-[13px] text-ink-3">{sub}</span>
        </span>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
        }}
        className="min-h-0 flex-1 overflow-y-auto bg-mist/50 px-3 py-4 sm:px-6"
      >
        {more && (
          <div className="mb-3 text-center">
            <button type="button" onClick={loadEarlier} className="rounded-full bg-white px-4 py-1.5 text-[14px] text-brand-700 shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-tint">
              Показать более ранние
            </button>
          </div>
        )}
        {loading && !msgs.length ? (
          <div className="grid h-full place-items-center text-ink-3">
            <Loader2 className="animate-spin" />
          </div>
        ) : loadError && !msgs.length ? (
          <p className="mx-auto max-w-[360px] rounded-xl bg-danger-soft px-4 py-3 text-center text-[15px] text-danger-600">{loadError}</p>
        ) : !msgs.length && !sending ? (
          <div className="grid h-full place-items-center p-4 text-center text-[15px] text-ink-2">
            <p className="max-w-[380px]">
              {kind === 'support'
                ? 'Опишите вопрос или проблему — администратор сайта ответит здесь же. Можно приложить скриншот.'
                : `Сообщений пока нет. Напишите первым — ${name} увидит сообщение в разделе «Сообщения»${mail ? ' и получит письмо на почту' : ''}.`}
            </p>
          </div>
        ) : (
          <ol className="grid grid-cols-1 gap-1.5">
            {msgs.map((m, i) => {
              const prev = msgs[i - 1];
              const newDay = !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString();
              const showName = groupNames && !m.mine && (newDay || prev?.author !== m.author || prev?.mine);
              const media = Boolean(m.files?.length);
              const read = m.id <= seen;
              return (
                <li key={m.id} className="grid min-w-0 grid-cols-1 gap-1.5">
                  {newDay && (
                    <span className="my-2 justify-self-center rounded-full bg-white px-3 py-1 text-[13px] text-ink-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
                      {dayLabel(m.at)}
                    </span>
                  )}
                  <div className={`flex ${m.mine ? 'justify-end' : 'justify-start'} ${!newDay && prev && prev.mine !== m.mine ? 'mt-1.5' : ''}`}>
                    <div
                      className={`max-w-[min(85%,560px)] min-w-0 rounded-[18px] [overflow-wrap:anywhere] ${media ? 'p-1' : 'px-3.5 py-2'} ${
                        m.mine ? 'msg-mine rounded-br-md bg-brand text-white' : 'rounded-bl-md bg-white text-ink shadow-[inset_0_0_0_1px_var(--color-line)]'
                      }`}
                    >
                      {showName && <p className={`mb-0.5 text-[13px] font-medium text-brand-700 ${media ? 'px-2.5 pt-1' : ''}`}>{m.author}</p>}
                      {media && <Attachments files={m.files!} mine={m.mine} local={local.current} onOpen={setView} />}
                      {m.text && (
                        <div className={`prose-chat text-[15px] leading-[1.5] ${media ? 'px-2.5 pt-1.5' : ''}`} dangerouslySetInnerHTML={{ __html: html(m) }} />
                      )}
                      <p className={`mt-0.5 flex items-center justify-end gap-1 text-[11px] ${media ? 'px-2 pb-0.5' : ''} ${m.mine ? 'text-white/75' : 'text-ink-3'}`}>
                        {hhmm(m.at)}
                        {m.mine &&
                          (read ? (
                            <CheckCheck size={15} className="text-white" aria-label="Прочитано" />
                          ) : (
                            <Check size={15} aria-label="Не прочитано" />
                          ))}
                      </p>
                    </div>
                  </div>
                  {m === lastMine && i === msgs.length - 1 && (
                    <span className={`flex items-center justify-end gap-1 pr-1 text-[12px] ${read ? 'text-brand-700' : 'text-ink-3'}`} data-read={read ? '1' : '0'}>
                      {read ? <CheckCheck size={14} /> : <Check size={14} />}
                      {read ? (seenAt ? `Прочитано ${readWhen(seenAt)}` : 'Прочитано') : 'Не прочитано'}
                    </span>
                  )}
                </li>
              );
            })}
            {sending && (
              <li className="flex min-w-0 justify-end">
                <div className={`max-w-[min(85%,560px)] min-w-0 rounded-[18px] rounded-br-md bg-brand/70 text-[15px] text-white [overflow-wrap:anywhere] ${sending.atts.length ? 'p-1' : 'px-3.5 py-2'}`}>
                  {sending.atts.length > 0 && (
                    <div className="flex max-w-[300px] flex-wrap gap-1">
                      {sending.atts.map((a) =>
                        a.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={a.key} src={a.url} alt="" className="h-20 w-20 rounded-[12px] object-cover opacity-80" />
                        ) : (
                          <span key={a.key} className="flex max-w-full items-center gap-1.5 rounded-[12px] bg-white/15 px-2.5 py-1.5 text-[13px]">
                            <FileText size={15} className="shrink-0" /> <span className="truncate">{a.name}</span>
                          </span>
                        ),
                      )}
                    </div>
                  )}
                  {sending.text && <p className={`whitespace-pre-wrap ${sending.atts.length ? 'px-2.5 pt-1.5' : ''}`}>{sending.text}</p>}
                  <p className={`mt-0.5 flex items-center justify-end gap-1 text-[11px] text-white/75 ${sending.atts.length ? 'px-2 pb-0.5' : ''}`}>
                    <Loader2 size={12} className="animate-spin" /> отправляю…
                  </p>
                </div>
              </li>
            )}
          </ol>
        )}
      </div>

      <form
        method="post"
        className="border-t border-line bg-white p-2.5 sm:p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {error && (
          <p className="mb-2 rounded-xl bg-danger-soft px-3 py-2 text-[14px] text-danger-600" role="alert">
            {error}
          </p>
        )}
        {atts.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-2 px-0.5 pt-1.5" aria-label="Прикреплённые файлы">
            {atts.map((a) => (
              <li key={a.key} className="relative" title={a.error ? `${a.name}: ${a.error}` : `${a.name} · ${fmtSize(a.size)}`}>
                {a.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url} alt={a.name} className={`h-16 w-16 rounded-[12px] object-cover ${a.error ? 'opacity-40' : ''}`} />
                ) : (
                  <span className={`flex h-16 w-[176px] items-center gap-2 rounded-[12px] bg-mist px-2.5 ${a.error ? 'opacity-60' : ''}`}>
                    <FileText size={22} className="shrink-0 text-brand-700" />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{a.name}</span>
                      <span className="block text-[12px] text-ink-3">{fmtSize(a.size)}</span>
                    </span>
                  </span>
                )}
                {!a.file && !a.error && (
                  <span className="absolute inset-x-1.5 bottom-1.5 h-1.5 overflow-hidden rounded-full bg-black/20" aria-label="Загружается">
                    <span className="block h-full rounded-full bg-white transition-[width]" style={{ width: `${Math.max(6, Math.round(a.progress * 100))}%` }} />
                  </span>
                )}
                {a.error && (
                  <span className="absolute inset-0 grid place-items-center rounded-[12px] ring-2 ring-danger-600" aria-label={`Не загрузился: ${a.error}`}>
                    <CircleAlert size={22} className="text-danger-600" />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeAtt(a.key)}
                  className="absolute -top-1.5 -right-1.5 grid h-6 w-6 place-items-center rounded-full bg-ink text-white shadow hover:bg-ink-2"
                  aria-label={`Убрать файл ${a.name}`}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:bg-mist hover:text-ink"
            aria-label="Прикрепить фото или файл"
            title="Прикрепить фото или файл"
          >
            <Paperclip size={20} />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
          {lessons.length > 0 && <LessonButton lessons={lessons} onPick={insertLesson} />}
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter — отправить (на телефоне Enter переносит строку, отправка — кнопкой)
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            maxLength={MAX}
            placeholder={atts.length ? 'Подпись' : 'Сообщение'}
            aria-label="Сообщение"
            className="input max-h-40 min-h-11 min-w-0 flex-1 resize-none py-2.5 leading-[1.4]"
          />
          <button
            type="submit"
            disabled={(!draft.trim() && !atts.length) || Boolean(sending)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand text-white transition-colors hover:bg-brand-600 disabled:opacity-40"
            aria-label="Отправить"
            title={uploading ? 'Отправится, когда файлы загрузятся' : 'Отправить'}
          >
            <SendHorizontal size={20} />
          </button>
        </div>
        <p className="mt-1.5 hidden px-1 text-[12px] text-ink-3 sm:block">
          Enter — отправить, Shift+Enter — новая строка. Фото и файлы — скрепкой, перетаскиванием или Ctrl+V. Формулы — между знаками $: $x^2$.
          {draft.length > MAX - 200 ? ` Осталось ${MAX - draft.length} символов.` : ''}
        </p>
      </form>

      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-30 grid place-items-center rounded-[18px] border-2 border-dashed border-brand bg-tint/90 text-center text-brand-800">
          <div>
            <Paperclip size={34} className="mx-auto" />
            <p className="mt-2 text-[17px] font-medium">Отпустите, чтобы прикрепить</p>
            <p className="text-[14px] text-ink-2">Фото и файлы до 10 МБ, не больше {MAX_FILES} за раз</p>
          </div>
        </div>
      )}
      {view && <Viewer view={view} local={local.current} onClose={closeView} />}
    </div>
  );
}

function LessonButton({ lessons, onPick }: { lessons: LessonLink[]; onPick: (l: LessonLink) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`grid h-11 w-11 place-items-center rounded-full transition-colors ${open ? 'bg-tint text-brand-800' : 'text-ink-2 hover:bg-mist hover:text-ink'}`}
        aria-label="Вставить ссылку на урок"
        title="Ссылка на урок"
      >
        <Video size={20} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Вставить ссылку на урок"
          className="absolute bottom-full left-0 z-20 mb-2 max-h-[min(60dvh,420px)] w-[320px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-2xl border border-line bg-white p-1.5 shadow-lift"
        >
          <p className="px-3 pt-1.5 pb-1 text-[13px] text-ink-3">Вставить ссылку на урок</p>
          {lessons.map((l) => (
            <button
              key={l.code}
              type="button"
              role="menuitem"
              onClick={() => {
                onPick(l);
                setOpen(false);
              }}
              className="flex w-full flex-col rounded-xl px-3 py-2 text-left hover:bg-mist"
            >
              <span className="truncate text-[15px] font-medium">{l.title}</span>
              <span className="text-[13px] text-ink-3">
                {l.startsAt ? lessonWhen(l.startsAt) : 'Без даты'} · <span className="font-mono">{l.code}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
