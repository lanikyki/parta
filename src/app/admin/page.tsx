import { Activity, Bot, ClipboardList, LifeBuoy, Mail, Search, Users, Video } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { LeadToggle } from '@/components/admin/LeadToggle';
import { TestMail } from '@/components/admin/TestMail';
import { AppHeader } from '@/components/app/AppHeader';
import { LocalTime } from '@/components/app/LocalTime';
import { aiConfigured } from '@/lib/ai';
import { isAdmin } from '@/lib/admin';
import { getUser } from '@/lib/auth';
import { gradeLabel } from '@/lib/brand';
import { one, q } from '@/lib/db';
import { EVENT_LABELS, type EventKind } from '@/lib/events';
import { livekitConfigured } from '@/lib/livekit';
import { mailConfigured } from '@/lib/mail';
import { supportEnabled } from '@/lib/messages';
import { firstParams } from '@/lib/nav';

export const metadata: Metadata = { title: 'Админка', robots: { index: false } };

type Tab = 'overview' | 'users' | 'leads' | 'events';
type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  grade: string | null;
  created_at: Date;
  last_at: Date | null;
  lessons: number;
  ai: number;
};
type EventRow = { id: string; at: Date; kind: string; user_id: string | null; actor: string | null; detail: string | null; ip: string | null; email: string | null };
type LeadRow = { id: string; name: string; contact: string; grade: string | null; subject: string | null; comment: string | null; created_at: Date; done_at: Date | null };

const iso = (d: Date | string) => new Date(d).toISOString();
const label = (k: string) => EVENT_LABELS[k as EventKind] ?? k;
const KIND_STYLE: Record<string, string> = {
  register: 'bg-tint text-brand-800',
  login_fail: 'bg-danger-soft text-danger-600',
  lead: 'bg-[#fff4cc] text-ink',
  ai_chat: 'bg-accent-soft text-accent-600',
  ai_tasks: 'bg-accent-soft text-accent-600',
  ai_summary: 'bg-accent-soft text-accent-600',
};

function Stat({ icon, title, value, note }: { icon: React.ReactNode; title: string; value: number | string; note?: string }) {
  return (
    <div className="card p-5">
      <p className="flex items-center gap-2 text-[14px] text-ink-2">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-tint text-brand-700">{icon}</span>
        {title}
      </p>
      <p className="mt-3 text-[32px] leading-none font-medium tracking-[-0.02em]">{value}</p>
      {note && <p className="mt-2 text-[13px] text-ink-3">{note}</p>}
    </div>
  );
}

function Events({ rows, showFilterLinks = true, compact = false }: { rows: EventRow[]; showFilterLinks?: boolean; compact?: boolean }) {
  if (!rows.length) return <p className="p-5 text-[15px] text-ink-2">Пока ничего не происходило.</p>;
  return (
    <div className="overflow-x-auto">
      <table className={`w-full text-left text-[14px] ${compact ? 'min-w-[620px]' : 'min-w-[760px]'}`}>
        <thead className="text-[13px] text-ink-3">
          <tr className="border-b border-line">
            <th className="px-4 py-2.5 font-normal">Когда</th>
            <th className="px-4 py-2.5 font-normal">Кто</th>
            <th className="px-4 py-2.5 font-normal">Что сделал</th>
            <th className="px-4 py-2.5 font-normal">Подробности</th>
            {!compact && <th className="px-4 py-2.5 font-normal">IP</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="border-b border-line last:border-0 align-top">
              <td className="px-4 py-2.5 whitespace-nowrap text-ink-2">
                <LocalTime iso={iso(e.at)} compact />
              </td>
              <td className="max-w-[240px] px-4 py-2.5">
                {e.user_id && showFilterLinks ? (
                  <Link href={`/admin?tab=events&user=${e.user_id}`} className="font-medium hover:text-brand-700 hover:underline">
                    {e.actor}
                  </Link>
                ) : (
                  <span className="font-medium">{e.actor || 'Гость'}</span>
                )}
                {e.email && (
                  <span className="block truncate text-[12px] text-ink-3" title={e.email}>
                    {e.email}
                  </span>
                )}
              </td>
              <td className="px-4 py-2.5 whitespace-nowrap">
                <span className={`rounded-full px-2.5 py-0.5 text-[13px] ${KIND_STYLE[e.kind] ?? 'bg-mist text-ink-2'}`}>{label(e.kind)}</span>
              </td>
              <td className="min-w-[200px] px-4 py-2.5 text-ink-2 [overflow-wrap:anywhere]">{e.detail}</td>
              {!compact && <td className="px-4 py-2.5 font-mono text-[12px] whitespace-nowrap text-ink-3">{e.ip}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Lead({ l }: { l: LeadRow }) {
  return (
    <li className={`flex min-w-0 flex-col gap-3 rounded-2xl p-4 [overflow-wrap:anywhere] @lg:flex-row @lg:items-start ${l.done_at ? 'bg-mist text-ink-2' : 'bg-white shadow-[inset_0_0_0_1px_var(--color-line)]'}`}>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-3">
          <b className="font-medium text-ink">{l.name}</b>
          <span className="font-mono text-[14px] text-ink [overflow-wrap:anywhere]">{l.contact}</span>
          <span className="text-[13px] text-ink-3">
            <LocalTime iso={iso(l.created_at)} compact />
          </span>
        </p>
        {(l.grade || l.subject) && <p className="mt-1 text-[14px] text-ink-2">{[l.grade && gradeLabel(l.grade), l.subject].filter(Boolean).join(' · ')}</p>}
        {l.comment && <p className="mt-1 text-[14px] whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]">«{l.comment}»</p>}
      </div>
      <LeadToggle id={l.id} done={Boolean(l.done_at)} />
    </li>
  );
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getUser();
  if (!user) redirect('/login?next=/admin');
  if (!isAdmin(user)) notFound();
  const sp = await firstParams(searchParams);
  const tab: Tab = (['users', 'leads', 'events'] as const).find((t) => t === sp.tab) ?? 'overview';
  const search = (sp.q || '').replaceAll('\u0000', '').trim().slice(0, 80);
  const kind = sp.kind && sp.kind in EVENT_LABELS ? sp.kind : '';
  const userId = /^[0-9a-f-]{36}$/.test(sp.user || '') ? sp.user! : '';

  const stats = await one<Record<string, number>>(
    `select
       (select count(*) from users)::int as users,
       (select count(*) from users where role = 'student')::int as students,
       (select count(*) from users where role = 'tutor')::int as tutors,
       (select count(*) from users where created_at > now() - interval '7 days')::int as users_week,
       (select count(*) from lessons)::int as lessons,
       (select count(*) from lessons where created_at > now() - interval '7 days')::int as lessons_week,
       (select count(*) from leads)::int as leads,
       (select count(*) from leads where done_at is null)::int as leads_new,
       (select count(*) from events where kind like 'ai_%' and at > now() - interval '1 day')::int as ai_day,
       (select count(*) from threads t where t.kind = 'support'
          and exists (select 1 from messages m where m.thread_id = t.id and m.id > t.b_read and m.sender_id = t.a_id))::int as support_new,
       (select count(*) from events where kind like 'ai_%' and at > now() - interval '7 days')::int as ai_week,
       (select count(distinct user_id) from events where user_id is not null and at > now() - interval '7 days')::int as active_week`,
  );
  const s = stats ?? {};

  // [вкладка, название, счётчик, подпись к счётчику (на телефоне прячется, чтобы не вылезать за кнопку)]
  const tabs: [Tab, string, string?, string?][] = [
    ['overview', 'Обзор'],
    ['users', 'Пользователи', String(s.users ?? 0)],
    ['leads', 'Обращения', s.leads_new ? String(s.leads_new) : undefined, 'новых'],
    ['events', 'Журнал'],
  ];

  let content: React.ReactNode = null;
  if (tab === 'overview') {
    const [events, leads, fresh] = await Promise.all([
      q<EventRow>('select e.*, u.email from events e left join users u on u.id = e.user_id order by e.at desc limit 12'),
      q<LeadRow>('select * from leads where done_at is null order by created_at desc limit 5'),
      q<UserRow>("select id, name, email, role, grade, created_at from users order by created_at desc limit 6"),
    ]);
    const status: [string, boolean, string][] = [
      ['Почта (коды и уведомления)', mailConfigured(), 'SMTP_USER и SMTP_PASS'],
      ['Поддержка в «Сообщениях»', supportEnabled(), 'ADMIN_EMAILS'],
      ['ИИ-помощник', aiConfigured(), 'AI_BASE_URL и AI_API_KEY'],
      ['Видео', livekitConfigured(), 'LIVEKIT_URL и ключи'],
    ];
    content = (
      <div className="grid gap-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={<Users size={17} />} title="Пользователи" value={s.users ?? 0} note={`учеников ${s.students ?? 0} · репетиторов ${s.tutors ?? 0} · +${s.users_week ?? 0} за неделю`} />
          <Stat icon={<ClipboardList size={17} />} title="Обращения с сайта" value={s.leads ?? 0} note={s.leads_new ? `${s.leads_new} ждут ответа` : 'все обработаны'} />
          <Stat icon={<Video size={17} />} title="Уроки" value={s.lessons ?? 0} note={`+${s.lessons_week ?? 0} за неделю`} />
          <Stat icon={<Bot size={17} />} title="Запросы к ИИ" value={s.ai_day ?? 0} note={`за сутки · ${s.ai_week ?? 0} за неделю · активных за неделю: ${s.active_week ?? 0}`} />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className="card min-w-0 overflow-hidden">
            <h2 className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 text-lg font-medium">
              Последние действия
              <Link href="/admin?tab=events" className="text-[14px] font-normal text-brand-700 hover:underline">
                Весь журнал
              </Link>
            </h2>
            <Events rows={events} compact />
          </section>
          <div className="grid min-w-0 content-start gap-6">
            {(s.support_new ?? 0) > 0 && (
              <Link href="/messages" className="flex items-center gap-3 rounded-[20px] bg-brand px-5 py-4 text-white transition-transform hover:-translate-y-0.5">
                <LifeBuoy size={22} className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <b className="block font-medium">Поддержка: {s.support_new} без ответа</b>
                  <span className="text-[14px] text-white/80">Откройте «Сообщения», чтобы ответить</span>
                </span>
              </Link>
            )}
            <section className="card p-5">
              <h2 className="text-lg font-medium">Новые обращения</h2>
              {leads.length ? (
                <ul className="mt-3 grid gap-2 @container">
                  {leads.map((l) => (
                    <Lead key={l.id} l={l} />
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[15px] text-ink-2">Новых обращений нет.</p>
              )}
            </section>
            <section className="card p-5">
              <h2 className="text-lg font-medium">Новые пользователи</h2>
              <ul className="mt-3 grid gap-2.5 text-[14px]">
                {fresh.map((u) => (
                  <li key={u.id} className="flex min-w-0 items-baseline justify-between gap-3">
                    <Link href={`/admin?tab=events&user=${u.id}`} className="min-w-0 truncate hover:text-brand-700">
                      <b className="font-medium">{u.name}</b> <span className="text-ink-3">{u.role === 'tutor' ? 'репетитор' : u.grade ? gradeLabel(u.grade).toLowerCase() : 'ученик'}</span>
                    </Link>
                    <span className="shrink-0 text-[13px] text-ink-3">
                      <LocalTime iso={iso(u.created_at)} compact withTime={false} />
                    </span>
                  </li>
                ))}
                {!fresh.length && <li className="text-ink-2">Пока никто не зарегистрировался.</li>}
              </ul>
            </section>
            <section className="card p-5">
              <h2 className="text-lg font-medium">Что подключено</h2>
              <ul className="mt-3 grid gap-2 text-[14px]">
                {status.map(([name, ok, hint]) => (
                  <li key={name} className="flex items-center justify-between gap-3">
                    <span>{name}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-[13px] ${ok ? 'bg-tint text-brand-800' : 'bg-danger-soft text-danger-600'}`}>
                      {ok ? 'работает' : `нет: ${hint}`}
                    </span>
                  </li>
                ))}
              </ul>
              <TestMail />
            </section>
          </div>
        </div>
      </div>
    );
  } else if (tab === 'users') {
    const like = `%${search.replace(/[%_\\]/g, '\\$&')}%`;
    const users = await q<UserRow>(
      `select u.id, u.name, u.email, u.role, u.grade, u.created_at,
              (select max(at) from events e where e.user_id = u.id) as last_at,
              ((select count(*) from lessons l where l.owner_id = u.id) + (select count(*) from lesson_members m where m.user_id = u.id))::int as lessons,
              (select count(*) from events e where e.user_id = u.id and e.kind like 'ai_%')::int as ai
         from users u
        where $1 = '' or u.name ilike $2 or u.email ilike $2
        order by u.created_at desc limit 300`,
      [search, like],
    );
    content = (
      <section className="card min-w-0 overflow-hidden">
        <form className="flex flex-wrap items-center gap-3 border-b border-line p-4" action="/admin">
          <input type="hidden" name="tab" value="users" />
          <label className="relative min-w-[220px] flex-1">
            <Search size={17} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-3" />
            <input className="input h-11 pl-10" name="q" defaultValue={search} placeholder="Имя или email" aria-label="Поиск" />
          </label>
          <button className="btn btn-soft btn-sm" type="submit">
            Найти
          </button>
          {search && (
            <Link href="/admin?tab=users" className="text-[14px] text-ink-2 hover:text-ink">
              Сбросить
            </Link>
          )}
        </form>
        {users.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-[14px]">
              <thead className="text-[13px] text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-4 py-2.5 font-normal">Кто</th>
                  <th className="px-4 py-2.5 font-normal">Роль</th>
                  <th className="px-4 py-2.5 font-normal">Зарегистрирован</th>
                  <th className="px-4 py-2.5 font-normal">Был на сайте</th>
                  <th className="px-4 py-2.5 font-normal">Уроков</th>
                  <th className="px-4 py-2.5 font-normal">Запросов к ИИ</th>
                  <th className="px-4 py-2.5 font-normal" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5">
                      <b className="block font-medium">{u.name}</b>
                      <span className="text-[13px] text-ink-3 [overflow-wrap:anywhere]">{u.email}</span>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{u.role === 'tutor' ? 'Репетитор' : u.grade ? `Ученик, ${gradeLabel(u.grade).toLowerCase()}` : 'Ученик'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-ink-2">
                      <LocalTime iso={iso(u.created_at)} compact />
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-ink-2">{u.last_at ? <LocalTime iso={iso(u.last_at)} compact /> : '—'}</td>
                    <td className="px-4 py-2.5">{u.lessons}</td>
                    <td className="px-4 py-2.5">{u.ai}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <Link href={`/admin?tab=events&user=${u.id}`} className="text-brand-700 hover:underline">
                        Действия →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-5 text-[15px] text-ink-2">{search ? 'Никого не нашлось.' : 'Пока никто не зарегистрировался.'}</p>
        )}
      </section>
    );
  } else if (tab === 'leads') {
    const leads = await q<LeadRow>('select * from leads order by (done_at is not null), created_at desc limit 300');
    content = (
      <section className="card p-5">
        <h2 className="text-lg font-medium">Обращения с сайта</h2>
        <p className="mt-1 text-[14px] text-ink-2">
          Вопросы из формы на главной странице. Ответьте человеку по указанному контакту и нажмите «Отметить обработанным» — обращение уйдёт вниз
          списка. Сообщения в поддержку от пользователей — в разделе «Сообщения».
        </p>
        {leads.length ? (
          <ul className="mt-4 grid gap-2 @container">
            {leads.map((l) => (
              <Lead key={l.id} l={l} />
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[15px] text-ink-2">Пока обращений нет.</p>
        )}
      </section>
    );
  } else {
    const [rows, who] = await Promise.all([
      q<EventRow>(
        `select e.*, u.email from events e left join users u on u.id = e.user_id
          where ($1 = '' or e.kind = $1) and ($2 = '' or e.user_id = $2)
          order by e.at desc limit 300`,
        [kind, userId],
      ),
      userId ? one<{ name: string; email: string }>('select name, email from users where id = $1', [userId]) : null,
    ]);
    content = (
      <section className="card min-w-0 overflow-hidden">
        <form className="flex flex-wrap items-center gap-3 border-b border-line p-4" action="/admin">
          <input type="hidden" name="tab" value="events" />
          {userId && <input type="hidden" name="user" value={userId} />}
          <select className="input h-11 w-auto min-w-[220px]" name="kind" defaultValue={kind} aria-label="Какие действия">
            <option value="">Все действия</option>
            {Object.entries(EVENT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button className="btn btn-soft btn-sm" type="submit">
            Показать
          </button>
          {who && (
            <span className="inline-flex items-center gap-2 rounded-full bg-tint px-3 py-1.5 text-[14px] text-brand-800">
              {who.name} · {who.email}
              <Link href={`/admin?tab=events${kind ? `&kind=${kind}` : ''}`} className="font-medium hover:underline" aria-label="Показать всех">
                ✕
              </Link>
            </span>
          )}
        </form>
        <Events rows={rows} showFilterLinks={!userId} />
      </section>
    );
  }

  return (
    <div className="min-h-dvh bg-mist/60">
      <AppHeader user={user} active="admin" />
      <main className="wrap py-8 sm:py-10">
        <h1 className="flex items-center gap-3 text-[30px] leading-tight font-medium sm:text-[36px]">
          <Activity className="text-brand" size={30} /> Админка
        </h1>
        <p className="mt-1 text-ink-2">Видно только администраторам из ADMIN_EMAILS. Здесь обращения, пользователи и журнал действий.</p>
        <nav className="mt-6 mb-6 grid grid-cols-2 gap-1 rounded-[14px] bg-white p-1 shadow-[inset_0_0_0_1px_var(--color-line)] sm:flex sm:w-fit sm:overflow-x-auto">
          {tabs.map(([key, name, badge, badgeNote]) => (
            <Link
              key={key}
              href={key === 'overview' ? '/admin' : `/admin?tab=${key}`}
              className={`flex h-10 shrink-0 items-center justify-center gap-2 rounded-[10px] px-3 text-[15px] whitespace-nowrap transition-colors sm:justify-start sm:px-4 ${
                tab === key ? 'bg-brand font-medium text-white' : 'text-ink-2 hover:text-ink'
              }`}
            >
              {name}
              {badge && (
                <span className={`rounded-full px-2 py-0.5 text-[12px] ${tab === key ? 'bg-white/20' : 'bg-mist text-ink-3'}`}>
                  {badge}
                  {badgeNote && <span className="hidden sm:inline"> {badgeNote}</span>}
                </span>
              )}
            </Link>
          ))}
        </nav>
        {content}
        <p className="mt-6 flex items-center gap-2 text-[13px] text-ink-3">
          <Mail size={14} /> Содержание вопросов к ИИ, чатов и переписки здесь не показывается — только сами действия.
        </p>
      </main>
    </div>
  );
}
