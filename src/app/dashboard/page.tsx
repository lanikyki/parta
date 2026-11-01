import { ArrowRight, Bot, CalendarDays, FileText, LifeBuoy, MessageCircle, Shield, Users, Video } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/app/AppHeader';
import { CreateLesson } from '@/components/app/CreateLesson';
import { InviteLink } from '@/components/app/InviteLink';
import { CopyLink, DeleteLesson, JoinByCode } from '@/components/app/LessonActions';
import { LocalTime } from '@/components/app/LocalTime';
import { TaskGenerator } from '@/components/app/TaskGenerator';
import { type User, getUser } from '@/lib/auth';
import { isAdmin } from '@/lib/admin';
import { one, q } from '@/lib/db';
import { renderMarkdown } from '@/lib/mathtext';
import { type Contact, ensureInviteCode, listContacts, listThreads, supportEnabled } from '@/lib/messages';

export const metadata: Metadata = { title: 'Личный кабинет' };

type Row = {
  code: string;
  title: string;
  subject: string | null;
  kind: string;
  starts_at: Date | null;
  duration_min: number;
  summary: string | null;
  summary_at: Date | null;
  created_at: Date;
  members?: number;
  tutor?: string;
};

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

function Summary({ text }: { text: string }) {
  return (
    <details className="group mt-3 rounded-2xl bg-mist px-4 open:pb-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-3 text-[15px] font-medium text-brand-800 [&::-webkit-details-marker]:hidden">
        <FileText size={17} /> Конспект урока
        <span className="ml-auto text-[13px] font-normal text-ink-3 group-open:hidden">Показать</span>
      </summary>
      <div className="prose-chat text-[15px]" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
    </details>
  );
}

function LessonCard({ l, tutorView }: { l: Row; tutorView: boolean }) {
  const when = iso(l.starts_at);
  return (
    <li className="card min-w-0 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-3">
            {l.subject && <span className="rounded-full bg-tint px-2.5 py-0.5 font-medium text-brand-800">{l.subject}</span>}
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={14} />
              {when ? <LocalTime iso={when} /> : 'Без даты'}
            </span>
            {tutorView ? (
              <span className="inline-flex items-center gap-1">
                <Users size={14} /> {l.kind === 'group' ? 'Группа' : 'Индивидуально'}
                {l.members ? ` · ${l.members}` : ''}
              </span>
            ) : (
              l.tutor && <span>Репетитор: {l.tutor}</span>
            )}
          </p>
          <h3 className="mt-2 truncate text-lg font-medium">{l.title}</h3>
          <p className="font-mono text-[12px] text-ink-3">{l.code}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {tutorView && <CopyLink code={l.code} className="max-sm:px-3" />}
          <Link href={`/lesson/${l.code}`} className="btn btn-primary btn-sm max-sm:px-3">
            <Video size={16} /> {tutorView ? 'Начать' : 'Войти'}
          </Link>
          {tutorView && <DeleteLesson code={l.code} />}
        </div>
      </div>
      {l.summary && <Summary text={l.summary} />}
    </li>
  );
}

/** Ученики репетитора или репетиторы ученика — с кнопкой «Написать». */
async function People({ user }: { user: User }) {
  const tutor = user.role === 'tutor';
  const [people, threads, invite] = await Promise.all([listContacts(user), listThreads(user), tutor ? ensureInviteCode(user.id) : null]);
  const unread = new Map(threads.filter((t) => t.kind === 'direct' && t.with).map((t) => [t.with!, t.unread]));
  const total = threads.reduce((n, t) => n + t.unread, 0);
  const shown = people.slice(0, 8);
  return (
    <section className="card p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-medium">{tutor ? 'Мои ученики' : 'Мои репетиторы'}</h2>
        <Link href="/messages" className="inline-flex items-center gap-1.5 text-[14px] font-medium text-brand-700 hover:underline">
          <MessageCircle size={15} /> Сообщения
          {total > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[12px] leading-none text-white">{total}</span>}
        </Link>
      </div>
      {shown.length ? (
        <ul className="mt-3 grid gap-1">
          {shown.map((p: Contact) => (
            <li key={p.id}>
              <Link href={`/messages?with=${p.id}`} className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-mist">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-tint font-medium text-brand-800">{(p.name.trim()[0] || '?').toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[15px] font-medium">{p.name}</b>
                  <span className="block truncate text-[13px] text-ink-3">{p.sub}</span>
                </span>
                {unread.get(p.id) ? (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[12px] leading-none font-medium text-white">{unread.get(p.id)}</span>
                ) : (
                  <span className="text-[14px] font-medium text-brand-700 opacity-0 transition-opacity group-hover:opacity-100 max-lg:opacity-100">Написать</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[15px] text-ink-2">
          {tutor
            ? 'Ученик появится здесь после первого урока с вами или когда зарегистрируется по вашей ссылке-приглашению.'
            : 'Репетитор появится здесь после первого урока с ним или когда вы перейдёте по его ссылке-приглашению.'}
        </p>
      )}
      {people.length > shown.length && (
        <Link href="/messages" className="mt-2 inline-block text-[14px] text-brand-700 hover:underline">
          Все {tutor ? 'ученики' : 'репетиторы'} ({people.length})
        </Link>
      )}
      {invite && (
        <div className="mt-4 grid gap-2 border-t border-line pt-4">
          <InviteLink code={invite} className="w-full" />
          <p className="text-[13px] text-ink-3">Отправьте ссылку новому ученику: он зарегистрируется и сразу появится в этом списке.</p>
        </div>
      )}
      {!tutor && supportEnabled() && (
        <Link href="/messages?support=1" className="mt-4 flex items-center gap-2 border-t border-line pt-4 text-[14px] text-ink-2 hover:text-ink">
          <LifeBuoy size={16} className="text-brand-700" /> Вопрос по сайту? Напишите в поддержку
        </Link>
      )}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[20px] border border-dashed border-line-2 p-8 text-center text-ink-2">{children}</div>;
}

async function TutorView({ user }: { user: User }) {
  const lessons = await q<Row>(
    `select l.code, l.title, l.subject, l.kind, l.starts_at, l.duration_min, l.summary, l.summary_at, l.created_at,
            (select count(*) from lesson_members m where m.lesson_id = l.id)::int as members
       from lessons l where l.owner_id = $1
      order by coalesce(l.starts_at, l.created_at) desc limit 100`,
    [user.id],
  );
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-medium">Мои уроки</h2>
          <CreateLesson />
        </div>
        {lessons.length ? (
          <ul className="mt-4 grid grid-cols-1 gap-3">
            {lessons.map((l) => (
              <LessonCard key={l.code} l={l} tutorView />
            ))}
          </ul>
        ) : (
          <div className="mt-4">
            <Empty>
              Уроков пока нет. Нажмите «Новый урок» и отправьте ученику ссылку — для входа на урок регистрация не нужна.
            </Empty>
          </div>
        )}
      </section>
      <aside className="grid content-start gap-6">
        <People user={user} />
        <TaskGenerator />
        <section className="card p-6">
          <h2 className="text-lg font-medium">Как провести урок</h2>
          <ol className="mt-3 grid gap-2.5 text-[15px] text-ink-2">
            {[
              'Создайте урок и скопируйте ссылку.',
              'Отправьте ссылку ученику — в «Сообщениях» или в любом мессенджере.',
              'Откройте урок: доска, видео и чат уже готовы.',
              'В конце нажмите «Итоги» — ИИ соберёт конспект.',
            ].map((t, i) => (
              <li key={t} className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-tint font-mono text-[12px] text-brand-800">{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
        </section>
      </aside>
    </div>
  );
}

async function StudentView({ user }: { user: User }) {
  const lessons = await q<Row>(
    `select l.code, l.title, l.subject, l.kind, l.starts_at, l.duration_min, l.summary, l.summary_at, l.created_at, u.name as tutor
       from lesson_members m join lessons l on l.id = m.lesson_id join users u on u.id = l.owner_id
      where m.user_id = $1 order by m.joined_at desc limit 100`,
    [user.id],
  );
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="grid content-start gap-6">
        <div className="card p-6">
          <h2 className="text-lg font-medium">Войти в урок</h2>
          <p className="mt-1 mb-4 text-[15px] text-ink-2">Вставьте ссылку, которую прислал репетитор.</p>
          <JoinByCode />
        </div>
        <div>
          <h2 className="text-xl font-medium">Мои уроки</h2>
          {lessons.length ? (
            <ul className="mt-4 grid grid-cols-1 gap-3">
              {lessons.map((l) => (
                <LessonCard key={l.code} l={l} tutorView={false} />
              ))}
            </ul>
          ) : (
            <div className="mt-4">
              <Empty>Здесь появятся уроки, на которых вы были, и конспекты к ним.</Empty>
            </div>
          )}
        </div>
      </section>
      <aside className="grid content-start gap-6">
        <Link href="/assistant" className="group rounded-[20px] bg-brand p-6 text-white transition-transform hover:-translate-y-0.5">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-white/15">
            <Bot size={22} />
          </span>
          <h2 className="mt-4 text-xl font-medium">ИИ-помощник</h2>
          <p className="mt-1 text-white/80">Объяснит тему, проверит решение и подскажет, с чего начать задачу.</p>
          <span className="mt-4 inline-flex items-center gap-1.5 font-medium">
            Задать вопрос <ArrowRight size={17} className="transition-transform group-hover:translate-x-1" />
          </span>
        </Link>
        <People user={user} />
      </aside>
    </div>
  );
}

/** Для администратора: сколько новых заявок и людей — подробности в админке. */
async function AdminCard() {
  const s = await one<{ leads: number; users: number; support: number }>(
    `select (select count(*) from leads where done_at is null)::int as leads,
            (select count(*) from users where created_at > now() - interval '7 days')::int as users,
            (select count(*) from threads t where t.kind = 'support'
               and exists (select 1 from messages m where m.thread_id = t.id and m.id > t.b_read and m.sender_id = t.a_id))::int as support`,
  );
  const leads = s?.leads ?? 0;
  const support = s?.support ?? 0;
  return (
    <Link
      href="/admin"
      className="group mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[20px] border border-line bg-white px-5 py-4 transition-shadow hover:shadow-soft"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-tint text-brand-700">
        <Shield size={19} />
      </span>
      <span className="min-w-0 flex-1">
        <b className="block font-medium">Админка</b>
        <span className="text-[15px] text-ink-2">
          {leads ? (
            <>
              <b className="font-medium text-accent-600">{leads}</b> {plural(leads, 'новое обращение', 'новых обращения', 'новых обращений')} с сайта
            </>
          ) : (
            'Новых обращений с сайта нет'
          )}
          {support > 0 && (
            <>
              {' · '}
              <b className="font-medium text-accent-600">{support}</b> в поддержке
            </>
          )}
          {' · '}за неделю {s?.users ?? 0} {plural(s?.users ?? 0, 'новый пользователь', 'новых пользователя', 'новых пользователей')}
        </span>
      </span>
      <span className="inline-flex items-center gap-1.5 text-[15px] font-medium text-brand-700">
        Открыть <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
      </span>
    </Link>
  );
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

export default async function Dashboard() {
  const user = await getUser();
  if (!user) redirect('/login?next=/dashboard');
  const first = user.name.split(' ')[0];
  return (
    <div className="min-h-dvh bg-mist/60">
      <AppHeader user={user} active="dashboard" />
      <main className="wrap py-8 sm:py-10">
        <h1 className="text-[30px] leading-tight font-medium sm:text-[36px]">Здравствуйте, {first}!</h1>
        <p className="mt-1 mb-8 text-ink-2">
          {user.role === 'tutor' ? 'Ваши уроки, ученики и конспекты.' : 'Уроки, репетиторы, конспекты и помощник по учёбе.'}
        </p>
        {isAdmin(user) && <AdminCard />}
        {user.role === 'tutor' ? <TutorView user={user} /> : <StudentView user={user} />}
      </main>
    </div>
  );
}
