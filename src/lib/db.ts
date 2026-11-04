import fs from 'node:fs/promises';

type Rows<T> = { rows: T[] };
type Query = { query<T>(sql: string, params?: unknown[]): Promise<Rows<T>> };
type Client = Query & { transaction<T>(fn: (tx: Query) => Promise<T>): Promise<T> };

const SCHEMA = `
create table if not exists users (
  id text primary key,
  role text not null check (role in ('student', 'tutor')),
  name text not null,
  email text not null unique,
  password_hash text not null,
  grade text,
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  token text primary key,
  user_id text not null references users(id) on delete cascade,
  expires_at timestamptz not null
);
create table if not exists lessons (
  id text primary key,
  code text not null unique,
  title text not null,
  subject text,
  kind text not null default 'individual',
  starts_at timestamptz,
  duration_min int not null default 60,
  owner_id text not null references users(id) on delete cascade,
  summary text,
  summary_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists lesson_members (
  lesson_id text not null references lessons(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (lesson_id, user_id)
);
create table if not exists boards (
  lesson_id text primary key references lessons(id) on delete cascade,
  data text not null,
  updated_at timestamptz not null default now()
);
create table if not exists assets (
  id text primary key,
  lesson_id text not null references lessons(id) on delete cascade,
  mime text not null,
  data bytea not null,
  created_at timestamptz not null default now()
);
create table if not exists chat_messages (
  id text primary key,
  lesson_id text not null references lessons(id) on delete cascade,
  author text not null,
  text text not null,
  created_at timestamptz not null default now()
);
create table if not exists leads (
  id text primary key,
  name text not null,
  contact text not null,
  grade text,
  subject text,
  comment text,
  created_at timestamptz not null default now()
);
-- Коды подтверждения из писем (регистрация, восстановление пароля)
create table if not exists email_codes (
  email text not null,
  purpose text not null,
  code_hash text not null,
  payload text,
  attempts int not null default 0,
  sends int not null default 1,
  first_sent_at timestamptz not null default now(),
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (email, purpose)
);
-- Журнал действий для админки: кто и что делал на сайте
create table if not exists events (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null,
  user_id text,
  actor text,
  detail text,
  ip text
);
alter table leads add column if not exists done_at timestamptz;
-- Ссылка-приглашение репетитора (/invite/код) и время последнего визита (для писем о новых сообщениях)
alter table users add column if not exists invite_code text;
alter table users add column if not exists seen_at timestamptz;
create unique index if not exists users_invite_idx on users(invite_code);
-- Ученики репетитора: появляются после первого урока или по ссылке-приглашению
create table if not exists contacts (
  tutor_id text not null references users(id) on delete cascade,
  student_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tutor_id, student_id)
);
create index if not exists contacts_student_idx on contacts(student_id);
-- Переписка: личная (репетитор и ученик) или с поддержкой сайта (b_id пустой, отвечают администраторы).
-- a_read и b_read — номер последнего прочитанного сообщения каждой стороной.
create table if not exists threads (
  id text primary key,
  kind text not null check (kind in ('direct', 'support')),
  a_id text not null references users(id) on delete cascade,
  b_id text references users(id) on delete cascade,
  last_at timestamptz not null default now(),
  a_read int not null default 0,
  b_read int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists threads_pair_idx on threads(kind, a_id, coalesce(b_id, ''));
create index if not exists threads_a_idx on threads(a_id, last_at desc);
create index if not exists threads_b_idx on threads(b_id, last_at desc);
create table if not exists messages (
  id serial primary key,
  thread_id text not null references threads(id) on delete cascade,
  sender_id text references users(id) on delete set null,
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_thread_idx on messages(thread_id, id);
-- Ученики, которые уже были на уроках до появления переписки
insert into contacts (tutor_id, student_id)
  select distinct l.owner_id, m.user_id from lesson_members m
    join lessons l on l.id = m.lesson_id join users u on u.id = m.user_id
   where u.role = 'student' and u.id <> l.owner_id
  on conflict do nothing;
-- Кто заходил в урок (чтобы репетитор мог удалить участника) и кого удалили
create table if not exists lesson_people (
  lesson_id text not null references lessons(id) on delete cascade,
  identity text not null,
  who text not null,
  name text not null,
  joined_at timestamptz not null default now(),
  primary key (lesson_id, identity)
);
create index if not exists lesson_people_who_idx on lesson_people(lesson_id, who);
create table if not exists lesson_bans (
  lesson_id text not null references lessons(id) on delete cascade,
  who text not null,
  name text not null,
  created_at timestamptz not null default now(),
  primary key (lesson_id, who)
);
alter table lessons add column if not exists locked boolean not null default false;
create index if not exists lessons_owner_idx on lessons(owner_id);
create index if not exists chat_lesson_idx on chat_messages(lesson_id, created_at);
create index if not exists events_at_idx on events(at desc);
create index if not exists events_user_idx on events(user_id, at desc);
-- Файлы и фото в сообщениях. Пока сообщение не отправлено, у файла нет message_id (такие удаляем через сутки).
-- a_read_at и b_read_at — когда сторона последний раз дочитала переписку (для «Прочитано в 14:05»).
alter table messages add column if not exists files jsonb;
alter table threads add column if not exists a_read_at timestamptz;
alter table threads add column if not exists b_read_at timestamptz;
create table if not exists message_files (
  id text primary key,
  uploader_id text references users(id) on delete set null,
  thread_id text references threads(id) on delete cascade,
  message_id int references messages(id) on delete cascade,
  name text not null,
  mime text not null,
  size int not null,
  w int,
  h int,
  data bytea not null,
  created_at timestamptz not null default now()
);
create index if not exists message_files_msg_idx on message_files(message_id);
create index if not exists message_files_up_idx on message_files(uploader_id, created_at);
-- Профиль: фото (сама картинка — в таблице avatars), о себе, предметы, подтверждённый телефон, настройки писем
alter table users add column if not exists avatar_at timestamptz;
alter table users add column if not exists about text;
alter table users add column if not exists subjects text;
alter table users add column if not exists phone text;
alter table users add column if not exists phone_at timestamptz;
create unique index if not exists users_phone_idx on users(phone);
alter table users add column if not exists notify_messages boolean not null default true;
alter table users add column if not exists notify_billing boolean not null default true;
create table if not exists avatars (
  user_id text primary key references users(id) on delete cascade,
  mime text not null,
  data bytea not null,
  updated_at timestamptz not null default now()
);
-- Подписка репетитора: тариф (start или pro) действует до plan_until. Сохранённая карта — для автопродления.
alter table users add column if not exists plan text;
alter table users add column if not exists plan_until timestamptz;
alter table users add column if not exists plan_period text;
alter table users add column if not exists autorenew boolean not null default false;
alter table users add column if not exists pay_method text;
alter table users add column if not exists pay_method_title text;
alter table users add column if not exists remind_for timestamptz;
alter table users add column if not exists expired_for timestamptz;
-- Реферальная программа: свой код для ссылки /r/код и кто пригласил
alter table users add column if not exists ref_code text;
create unique index if not exists users_ref_idx on users(ref_code);
alter table users add column if not exists referred_by text references users(id) on delete set null;
create index if not exists users_referred_idx on users(referred_by);
-- Браузеры, из которых входили в аккаунт (чтобы нельзя было пригласить самого себя)
create table if not exists user_devices (
  user_id text not null references users(id) on delete cascade,
  device text not null,
  last_at timestamptz not null default now(),
  primary key (user_id, device)
);
create index if not exists user_devices_dev_idx on user_devices(device);
-- Код подтверждения телефона (последние 4 цифры номера, с которого позвонили)
create table if not exists phone_codes (
  user_id text primary key references users(id) on delete cascade,
  phone text not null,
  code_hash text not null,
  attempts int not null default 0,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null
);
-- Пробный видеоурок: один на аккаунт и один на номер телефона (запись остаётся и после удаления аккаунта)
create table if not exists trials (
  id text primary key,
  user_id text references users(id) on delete set null,
  phone text not null,
  lesson_id text references lessons(id) on delete set null,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  closed_at timestamptz
);
create unique index if not exists trials_user_idx on trials(user_id);
create unique index if not exists trials_phone_idx on trials(phone);
create index if not exists trials_lesson_idx on trials(lesson_id);
-- Платежи за подписку. Суммы — в копейках. provider: yookassa, test (тестовый режим), bonus (целиком бонусами), admin (выдал администратор)
create table if not exists payments (
  id text primary key,
  user_id text references users(id) on delete set null,
  provider text not null,
  provider_id text,
  plan text not null,
  period text not null,
  days int not null,
  price_kop int not null,
  discount_kop int not null default 0,
  bonus_kop int not null default 0,
  amount_kop int not null,
  refunded_kop int not null default 0,
  status text not null default 'pending',
  save_card boolean not null default false,
  recurring boolean not null default false,
  card text,
  card_fp text,
  note text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  applied_at timestamptz
);
create unique index if not exists payments_provider_idx on payments(provider, provider_id);
create index if not exists payments_user_idx on payments(user_id, created_at desc);
create index if not exists payments_status_idx on payments(status, created_at);
-- Возвраты: одно уведомление кассы о возврате учитываем один раз
create table if not exists refunds (
  id text primary key,
  payment_id text not null references payments(id) on delete cascade,
  amount_kop int not null,
  created_at timestamptz not null default now()
);
-- Бонусный баланс: начисления за приглашённых (через несколько дней после оплаты), списания при оплате
create table if not exists bonus_ledger (
  id bigserial primary key,
  user_id text not null references users(id) on delete cascade,
  amount_kop int not null,
  kind text not null,
  payment_id text references payments(id) on delete set null,
  from_user text references users(id) on delete set null,
  note text,
  available_at timestamptz not null default now(),
  canceled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists bonus_user_idx on bonus_ledger(user_id, created_at desc);
create unique index if not exists bonus_once_idx on bonus_ledger(payment_id, kind) where payment_id is not null;
-- Сколько раз за месяц спрашивали ИИ: chat — помощник, extra — конспекты и подбор задач
create table if not exists ai_usage (
  user_id text not null references users(id) on delete cascade,
  month text not null,
  kind text not null,
  n int not null default 0,
  primary key (user_id, month, kind)
);
`;

async function init(): Promise<Client> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import('pg');
    const needsSsl = /sslmode=require|neon\.tech|supabase\.co|supabase\.com/.test(url);
    const pool = new Pool({ connectionString: url, max: 5, ssl: needsSsl ? { rejectUnauthorized: false } : undefined });
    await pool.query(SCHEMA);
    return {
      query: (sql, params) => pool.query(sql, params as unknown[]) as never,
      async transaction(fn) {
        const c = await pool.connect();
        try {
          await c.query('begin');
          const out = await fn({ query: (sql, params) => c.query(sql, params as unknown[]) as never });
          await c.query('commit');
          return out;
        } catch (e) {
          await c.query('rollback').catch(() => {});
          throw e;
        } finally {
          c.release();
        }
      },
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR || './data/db';
  await fs.mkdir(dir, { recursive: true });
  const pg = new PGlite(dir);
  await pg.exec(SCHEMA);
  return {
    query: (sql, params) => pg.query(sql, params as unknown[]) as never,
    transaction: (fn) => pg.transaction((tx) => fn({ query: (sql, params) => tx.query(sql, params as unknown[]) as never })),
  };
}

const g = globalThis as unknown as { __partaDb?: Promise<Client> };

export function db() {
  if (!g.__partaDb) {
    g.__partaDb = init().catch((e) => {
      g.__partaDb = undefined;
      throw e;
    });
    // Фоновые задачи (конец пробного урока, напоминания о подписке, автопродление) — в том же процессе, что и база
    g.__partaDb.then(() => import('./jobs').then((m) => m.startJobs())).catch(() => {});
  }
  return g.__partaDb;
}

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const client = await db();
  return (await client.query<T>(sql, params)).rows;
}

export async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await q<T>(sql, params))[0] ?? null;
}

export type Tx = {
  q<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
};

/**
 * Несколько запросов как одно целое: либо выполнятся все, либо ни один (например, оплата и продление подписки).
 * Внутри используйте только t.q и t.one — обычные q и one будут ждать конца этой транзакции.
 */
export async function tx<T>(fn: (t: Tx) => Promise<T>): Promise<T> {
  const client = await db();
  return client.transaction((c) =>
    fn({
      q: async <R,>(sql: string, params: unknown[] = []) => (await c.query<R>(sql, params)).rows,
      one: async <R,>(sql: string, params: unknown[] = []) => (await c.query<R>(sql, params)).rows[0] ?? null,
    }),
  );
}

/** Простая очередь на ключ — чтобы параллельные сохранения доски не затирали друг друга. */
const locks = new Map<string, Promise<unknown>>();
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(key, next);
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}
