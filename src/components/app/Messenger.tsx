'use client';

import { ArrowLeft, CheckCheck, LifeBuoy, Loader2, MessageCircle, PenSquare, SendHorizontal, Video, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Contact, Msg, ThreadItem } from '@/lib/messages';
import { renderMarkdown } from '@/lib/mathtext';
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
function Avatar({ name, support, size = 44 }: { name: string; support?: boolean; size?: number }) {
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
  if (!res.ok) throw new Error(out.error || 'Нет связи с сайтом, попробуйте ещё раз');
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

  const current = openId ? threads.find((t) => t.id === openId) : undefined;
  const header = useMemo(() => {
    if (!sel) return null;
    if ('to' in sel) return { name: sel.to.name, sub: sel.to.sub, kind: 'direct' as const };
    if ('support' in sel) return { name: 'Поддержка', sub: 'Вопросы по сайту — ответят администраторы', kind: 'support' as const };
    return current ? { name: current.name, sub: current.sub, kind: current.kind } : { name: '…', sub: '', kind: 'direct' as const };
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
          lastAt: m.at,
          unread: 0,
        };
        return [{ ...base, lastText: m.text.slice(0, 200), lastMine: true, lastAt: m.at, unread: 0 }, ...list.filter((t) => t.id !== threadId)];
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
                    <Avatar name={t.name} support={t.kind === 'support'} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <b className="truncate font-medium">{t.name}</b>
                        {t.kind === 'inbox' && <span className="shrink-0 rounded-full bg-[#fff4cc] px-2 text-[12px] text-ink">поддержка</span>}
                        <span className="ml-auto shrink-0 text-[12px] text-ink-3" suppressHydrationWarning>
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
            Вопрос по сайту? Напишите в поддержку
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
            me={me}
            lessons={me.role === 'tutor' ? lessons : []}
            mail={mail}
            onBack={() => setSel(null)}
            onSent={onSent}
            onRead={markRead}
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
            ? 'Напишите ученику — например, отправьте ссылку на ближайший урок.'
            : 'Напишите репетитору — например, договоритесь о времени урока.'}
        </p>
      ) : tutor ? (
        <>
          <p>
            <b className="block text-[17px] font-medium text-ink">Здесь будет переписка с учениками</b>
            Ученик появится после первого урока с вами или когда зарегистрируется по вашей ссылке-приглашению.
          </p>
          {invite && <InviteLink code={invite} />}
        </>
      ) : (
        <p>
          <b className="block text-[17px] font-medium text-ink">Здесь будет переписка с репетиторами</b>
          Репетитор появится после первого урока с ним или когда вы перейдёте по его ссылке-приглашению.
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
              <Avatar name={c.name} size={40} />
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
                  <p>Учеников пока нет. Ученик появится после первого урока с вами или когда зарегистрируется по вашей ссылке-приглашению.</p>
                  {invite && <InviteLink code={invite} />}
                </>
              ) : (
                <p>Репетиторов пока нет. Репетитор появится после первого урока с ним или когда вы перейдёте по его ссылке-приглашению.</p>
              )}
            </div>
          )}
          {contacts.length > 0 && !list.length && <p className="px-5 py-3 text-[15px] text-ink-2">Никого не нашли.</p>}
          {support && !me.admin && (
            <button type="button" onClick={() => onChoose({ support: true })} className="mt-1 flex w-full items-center gap-3 border-t border-line px-5 py-3 text-left hover:bg-mist">
              <Avatar name="" support size={40} />
              <span className="min-w-0">
                <b className="block font-medium">Поддержка</b>
                <span className="block text-[13px] text-ink-3">Вопросы и проблемы с сайтом</span>
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

function Chat({
  threadId,
  target,
  name,
  sub,
  kind,
  me,
  lessons,
  mail,
  onBack,
  onSent,
  onRead,
}: {
  threadId: string | null;
  target: { to?: string; support?: boolean };
  name: string;
  sub: string;
  kind: ThreadItem['kind'];
  me: Me;
  lessons: LessonLink[];
  mail: boolean;
  onBack: () => void;
  onSent: (threadId: string, m: Msg) => void;
  onRead: (threadId: string) => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [seen, setSeen] = useState(0);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(Boolean(threadId));
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const restore = useRef<{ h: number; top: number } | null>(null);
  const lastId = useRef(0);
  const busy = useRef(false);
  lastId.current = msgs.length ? msgs[msgs.length - 1].id : 0;

  // Первая загрузка: последние 100 сообщений
  useEffect(() => {
    if (!threadId || lastId.current) return;
    let alive = true;
    setLoading(true);
    api<{ messages: Msg[]; seen: number; more: boolean }>(`/api/messages/${threadId}`)
      .then((out) => {
        if (!alive) return;
        stick.current = true;
        setMsgs((m) => mergeMsgs(m, out.messages));
        setSeen(out.seen);
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

  // Новые сообщения — раз в 3 секунды, пока вкладка открыта
  useEffect(() => {
    if (!threadId) return;
    const tick = async () => {
      if (document.hidden || busy.current || !lastId.current) return;
      try {
        const out = await api<{ messages: Msg[]; seen: number }>(`/api/messages/${threadId}?after=${lastId.current}`);
        setSeen(out.seen);
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

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setError('');
    setSending(text);
    setDraft('');
    stick.current = true;
    busy.current = true;
    try {
      const out = await api<{ id?: string; message: Msg }>(threadId ? `/api/messages/${threadId}` : '/api/messages', threadId ? { text } : { ...target, text });
      setMsgs((m) => mergeMsgs(m, [out.message]));
      onSent(out.id || threadId || '', out.message);
    } catch (e) {
      setError((e as Error).message);
      setDraft((d) => d || text);
    } finally {
      setSending(null);
      busy.current = false;
      inputRef.current?.focus();
    }
  }

  const insertLesson = (l: LessonLink) => {
    const when = lessonWhen(l.startsAt);
    const line = `Урок «${l.title}»${when ? `, ${when}` : ''}: ${location.origin}/lesson/${l.code}`;
    setDraft((d) => (d.trim() ? `${d.trimEnd()}\n${line}` : line));
    inputRef.current?.focus();
  };

  const lastMine = [...msgs].reverse().find((m) => m.mine);
  const groupNames = kind !== 'direct';

  return (
    <>
      <div className="flex items-center gap-3 border-b border-line px-2 py-2.5 sm:px-4">
        <button type="button" onClick={onBack} className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] text-ink-2 hover:bg-mist lg:hidden" aria-label="К списку переписок">
          <ArrowLeft size={20} />
        </button>
        <Avatar name={name} support={kind === 'support'} size={40} />
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
                ? 'Опишите вопрос или проблему — администратор сайта ответит здесь же.'
                : `Сообщений пока нет. Напишите первым — ${name} увидит сообщение в разделе «Сообщения»${mail ? ' и получит письмо на почту' : ''}.`}
            </p>
          </div>
        ) : (
          <ol className="grid gap-1.5">
            {msgs.map((m, i) => {
              const prev = msgs[i - 1];
              const newDay = !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString();
              const showName = groupNames && !m.mine && (newDay || prev?.author !== m.author || prev?.mine);
              return (
                <li key={m.id} className="grid gap-1.5">
                  {newDay && (
                    <span className="my-2 justify-self-center rounded-full bg-white px-3 py-1 text-[13px] text-ink-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
                      {dayLabel(m.at)}
                    </span>
                  )}
                  <div className={`flex ${m.mine ? 'justify-end' : 'justify-start'} ${!newDay && prev && prev.mine !== m.mine ? 'mt-1.5' : ''}`}>
                    <div
                      className={`max-w-[min(85%,560px)] rounded-[18px] px-3.5 py-2 [overflow-wrap:anywhere] ${
                        m.mine ? 'msg-mine rounded-br-md bg-brand text-white' : 'rounded-bl-md bg-white text-ink shadow-[inset_0_0_0_1px_var(--color-line)]'
                      }`}
                    >
                      {showName && <p className="mb-0.5 text-[13px] font-medium text-brand-700">{m.author}</p>}
                      <div className="prose-chat text-[15px] leading-[1.5]" dangerouslySetInnerHTML={{ __html: html(m) }} />
                      <p className={`mt-0.5 text-right text-[11px] ${m.mine ? 'text-white/75' : 'text-ink-3'}`}>{hhmm(m.at)}</p>
                    </div>
                  </div>
                  {m === lastMine && m.id <= seen && i === msgs.length - 1 && (
                    <span className="flex items-center justify-end gap-1 pr-1 text-[12px] text-ink-3">
                      <CheckCheck size={14} /> Прочитано
                    </span>
                  )}
                </li>
              );
            })}
            {sending && (
              <li className="flex justify-end">
                <div className="max-w-[min(85%,560px)] rounded-[18px] rounded-br-md bg-brand/70 px-3.5 py-2 text-[15px] whitespace-pre-wrap text-white [overflow-wrap:anywhere]">
                  {sending}
                  <p className="mt-0.5 text-right text-[11px] text-white/75">отправляю…</p>
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
        {error && <p className="mb-2 rounded-xl bg-danger-soft px-3 py-2 text-[14px] text-danger-600">{error}</p>}
        <div className="flex items-end gap-1.5 sm:gap-2">
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
            placeholder="Сообщение"
            aria-label="Сообщение"
            className="input max-h-40 min-h-11 flex-1 resize-none py-2.5 leading-[1.4]"
          />
          <button
            type="submit"
            disabled={!draft.trim() || Boolean(sending)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand text-white transition-colors hover:bg-brand-600 disabled:opacity-40"
            aria-label="Отправить"
            title="Отправить"
          >
            <SendHorizontal size={20} />
          </button>
        </div>
        <p className="mt-1.5 hidden px-1 text-[12px] text-ink-3 sm:block">
          Enter — отправить, Shift+Enter — новая строка. Формулы — между знаками $: $x^2$.{draft.length > MAX - 200 ? ` Осталось ${MAX - draft.length} символов.` : ''}
        </p>
      </form>
    </>
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
        title="Ссылка на урок"
      >
        <Video size={20} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Вставить ссылку на урок"
          className="absolute bottom-full left-0 z-20 mb-2 max-h-[min(60dvh,420px)] w-[320px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-2xl border border-line bg-white p-1.5 shadow-lift"
        >
          <p className="px-3 pt-1.5 pb-1 text-[13px] text-ink-3">Вставить ссылку на урок</p>
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
