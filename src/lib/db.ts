import fs from 'node:fs/promises';

type Rows<T> = { rows: T[] };
type Client = { query<T>(sql: string, params?: unknown[]): Promise<Rows<T>> };

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
create index if not exists lessons_owner_idx on lessons(owner_id);
create index if not exists chat_lesson_idx on chat_messages(lesson_id, created_at);
create index if not exists events_at_idx on events(at desc);
create index if not exists events_user_idx on events(user_id, at desc);
`;

async function init(): Promise<Client> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import('pg');
    const needsSsl = /sslmode=require|neon\.tech|supabase\.co|supabase\.com/.test(url);
    const pool = new Pool({ connectionString: url, max: 5, ssl: needsSsl ? { rejectUnauthorized: false } : undefined });
    await pool.query(SCHEMA);
    return { query: (sql, params) => pool.query(sql, params as unknown[]) as never };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR || './data/db';
  await fs.mkdir(dir, { recursive: true });
  const pg = new PGlite(dir);
  await pg.exec(SCHEMA);
  return { query: (sql, params) => pg.query(sql, params as unknown[]) as never };
}

const g = globalThis as unknown as { __partaDb?: Promise<Client> };

export function db() {
  g.__partaDb ??= init().catch((e) => {
    g.__partaDb = undefined;
    throw e;
  });
  return g.__partaDb;
}

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const client = await db();
  return (await client.query<T>(sql, params)).rows;
}

export async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await q<T>(sql, params))[0] ?? null;
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
