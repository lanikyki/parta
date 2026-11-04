import { adminEmails, isAdmin } from './admin';
import type { User } from './auth';
import { avatarUrl } from './avatar';
import { BRAND, gradeLabel } from './brand';
import { one, q } from './db';
import { logEvent } from './events';
import { siteUrl } from './http';
import { inviteCode, isInviteCode, uid } from './ids';
import { letter, mailConfigured, mailErrorText, sendMail } from './mail';
import { filesSummary, MAX_FILES, msgPreview, type MsgFile } from './msgfile';

// Переписка внутри сайта: репетитор ↔ ученик и пользователь ↔ поддержка (отвечают администраторы).

/** Тот, кому можно написать: ученик репетитора или репетитор ученика. */
export type Contact = { id: string; name: string; sub: string; avatar: string | null };
export type ThreadItem = {
  id: string;
  /** direct — личная переписка, support — моё обращение в поддержку, inbox — обращение пользователя (видят админы) */
  kind: 'direct' | 'support' | 'inbox';
  with: string | null;
  name: string;
  sub: string;
  lastText: string;
  lastMine: boolean;
  /** Собеседник прочитал последнее (моё) сообщение */
  lastRead: boolean;
  lastAt: string;
  unread: number;
  avatar: string | null;
};
export type Msg = { id: number; mine: boolean; author: string; text: string; at: string; files?: MsgFile[] };

type Me = Pick<User, 'id' | 'name' | 'email' | 'role'>;
type Thread = {
  id: string;
  kind: 'direct' | 'support';
  a_id: string;
  b_id: string | null;
  a_read: number;
  b_read: number;
  a_read_at: Date | null;
  b_read_at: Date | null;
};
/** Доступ к переписке: чья сторона (a или b) и отвечает ли человек от имени поддержки. */
export type Access = { thread: Thread; side: 'a' | 'b'; staff: boolean };

export const MAX_TEXT = 2000;
const iso = (d: Date | string) => new Date(d).toISOString();
const personSub = (p: { role: string | null; grade: string | null }) =>
  p.role === 'tutor' ? 'Репетитор' : p.grade ? `Ученик · ${gradeLabel(p.grade).toLowerCase()}` : 'Ученик';

/** Поддержка работает, если указан хотя бы один администратор (ADMIN_EMAILS). */
export const supportEnabled = () => adminEmails().length > 0;

/** Текст сообщения: без лишних пустых строк и не длиннее 2000 символов. */
export function cleanText(v: unknown) {
  if (typeof v !== 'string') return '';
  return v
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT);
}

/** Номера прикреплённых файлов из запроса: без повторов, не больше 10. null — если прислали что-то не то. */
export function cleanFileIds(v: unknown): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > MAX_FILES) return null;
  const ids = [...new Set(v)];
  return ids.every((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/.test(x)) ? (ids as string[]) : null;
}

/* ───────── Ученики и репетиторы ───────── */

export async function listContacts(user: Pick<User, 'id' | 'role'>): Promise<Contact[]> {
  const rows =
    user.role === 'tutor'
      ? await q<{ id: string; name: string; role: string; grade: string | null; avatar_at: Date | null }>(
          `select u.id, u.name, u.role, u.grade, u.avatar_at from contacts c join users u on u.id = c.student_id
            where c.tutor_id = $1 order by c.created_at desc limit 500`,
          [user.id],
        )
      : await q<{ id: string; name: string; role: string; grade: string | null; avatar_at: Date | null }>(
          `select u.id, u.name, u.role, u.grade, u.avatar_at from contacts c join users u on u.id = c.tutor_id
            where c.student_id = $1 order by c.created_at desc limit 200`,
          [user.id],
        );
  return rows.map((r) => ({ id: r.id, name: r.name, sub: personSub(r), avatar: r.avatar_at ? avatarUrl(r.id, r.avatar_at) : null }));
}

/** Ученик побывал на уроке репетитора — теперь они могут переписываться. */
export async function linkStudent(tutorId: string, studentId: string) {
  if (tutorId === studentId) return false;
  const r = await q('insert into contacts (tutor_id, student_id) values ($1, $2) on conflict do nothing returning tutor_id', [tutorId, studentId]);
  return r.length > 0;
}

const canWrite = async (a: string, b: string) =>
  Boolean(await one('select 1 from contacts where (tutor_id = $1 and student_id = $2) or (tutor_id = $2 and student_id = $1)', [a, b]));

/* ───────── Ссылка-приглашение репетитора ───────── */

export async function ensureInviteCode(userId: string) {
  for (let i = 0; i < 5; i++) {
    const row = await one<{ invite_code: string | null }>('select invite_code from users where id = $1', [userId]);
    if (!row || row.invite_code) return row?.invite_code ?? null;
    try {
      await q('update users set invite_code = $2 where id = $1 and invite_code is null', [userId, inviteCode()]);
    } catch (e) {
      if (!/unique|duplicate/i.test(String((e as Error).message))) throw e;
    }
  }
  return null;
}

export const inviter = async (code: string) =>
  isInviteCode(code) ? one<{ id: string; name: string }>("select id, name from users where invite_code = $1 and role = 'tutor'", [code]) : null;

/** Ученик принял приглашение: добавляем его к репетитору. Возвращает репетитора или null. */
export async function acceptInvite(user: { id: string; name: string; role: string }, code: string, req?: Request) {
  if (user.role !== 'student') return null;
  const tutor = await inviter(code);
  if (!tutor || tutor.id === user.id) return null;
  if (await linkStudent(tutor.id, user.id)) logEvent('invite', { user, detail: `к репетитору ${tutor.name}`, req });
  return tutor;
}

/* ───────── Список переписок и непрочитанное ───────── */

type ThreadRow = {
  id: string;
  kind: string;
  a_id: string;
  last_at: Date;
  o_id: string | null;
  o_name: string | null;
  o_role: string | null;
  o_grade: string | null;
  o_avatar_at: Date | null;
  o_email: string | null;
  last_id: number | null;
  last_text: string | null;
  last_files: MsgFile[] | null;
  last_sender: string | null;
  o_read: number;
  unread: number;
};

export async function listThreads(user: Me): Promise<ThreadItem[]> {
  const rows = await q<ThreadRow>(
    `select t.id, t.kind, t.a_id, t.last_at,
            o.id as o_id, o.name as o_name, o.role as o_role, o.grade as o_grade, o.email as o_email, o.avatar_at as o_avatar_at,
            lm.id as last_id, lm.text as last_text, lm.files as last_files, lm.sender_id as last_sender,
            (case when t.a_id = $1 then t.b_read else t.a_read end) as o_read,
            (select count(*) from messages m where m.thread_id = t.id and (case
               when t.a_id = $1 then m.id > t.a_read and m.sender_id is distinct from $1
               when t.kind = 'direct' then m.id > t.b_read and m.sender_id is distinct from $1
               else m.id > t.b_read and m.sender_id = t.a_id end))::int as unread
       from threads t
       left join users o on o.id = (case when t.a_id = $1 then t.b_id else t.a_id end)
       left join lateral (select m.id, m.text, m.files, m.sender_id from messages m where m.thread_id = t.id order by m.id desc limit 1) lm on true
      where t.a_id = $1 or t.b_id = $1 or ($2 and t.kind = 'support')
      order by t.last_at desc limit 300`,
    [user.id, isAdmin(user)],
  );
  return rows.map((r) => {
    const kind: ThreadItem['kind'] = r.kind === 'direct' ? 'direct' : r.a_id === user.id ? 'support' : 'inbox';
    return {
      id: r.id,
      kind,
      with: kind === 'support' ? null : r.o_id,
      name: kind === 'support' ? 'Поддержка' : r.o_name || 'Пользователь',
      sub:
        kind === 'support'
          ? `Вопросы по сайту «${BRAND.name}»`
          : kind === 'inbox'
            ? `Обращение в поддержку · ${r.o_email ?? ''}`
            : personSub({ role: r.o_role, grade: r.o_grade }),
      lastText: msgPreview(r.last_text || '', r.last_files).slice(0, 200),
      lastMine: r.last_sender === user.id,
      lastRead: r.last_sender === user.id && (r.last_id ?? 0) <= r.o_read,
      lastAt: iso(r.last_at),
      unread: r.unread,
      avatar: kind !== 'support' && r.o_id && r.o_avatar_at ? avatarUrl(r.o_id, r.o_avatar_at) : null,
    };
  });
}

/** Сколько непрочитанных сообщений — для значка в шапке. */
export async function unreadTotal(user: Me) {
  const r = await one<{ n: number }>(
    `select ((select count(*) from messages m join threads t on t.id = m.thread_id
               where ((t.a_id = $1 and m.id > t.a_read) or (t.b_id = $1 and m.id > t.b_read))
                 and m.sender_id is distinct from $1)
           + (case when $2 then (select count(*) from messages m join threads t on t.id = m.thread_id
               where t.kind = 'support' and t.a_id <> $1 and m.id > t.b_read and m.sender_id = t.a_id) else 0 end))::int as n`,
    [user.id, isAdmin(user)],
  );
  return r?.n ?? 0;
}

// Когда человек последний раз был на сайте: письмо о новом сообщении шлём, только если его нет онлайн
const touched = new Map<string, number>();
export function touch(userId: string) {
  const now = Date.now();
  if (now - (touched.get(userId) ?? 0) < 60e3) return;
  if (touched.size > 20000) touched.clear();
  touched.set(userId, now);
  q('update users set seen_at = now() where id = $1', [userId]).catch(() => {});
}

/* ───────── Одна переписка ───────── */

const THREAD_COLS = 'id, kind, a_id, b_id, a_read, b_read, a_read_at, b_read_at';

export async function openThread(user: Me, id: string): Promise<Access | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const t = await one<Thread>(`select ${THREAD_COLS} from threads where id = $1`, [id]);
  if (!t) return null;
  if (t.a_id === user.id) return { thread: t, side: 'a', staff: false };
  if (t.kind === 'direct' && t.b_id === user.id) return { thread: t, side: 'b', staff: false };
  if (t.kind === 'support' && isAdmin(user)) return { thread: t, side: 'b', staff: true };
  return null;
}

/** Находит или заводит переписку: с учеником/репетитором (to) или с поддержкой. */
export async function startThread(user: Me, target: { to?: string; support?: boolean }): Promise<Access | { error: string; status: number }> {
  if (target.support) {
    if (!supportEnabled()) return { error: 'Поддержка на сайте пока не подключена', status: 400 };
    await q("insert into threads (id, kind, a_id) values ($1, 'support', $2) on conflict do nothing", [uid(), user.id]);
    const t = await one<Thread>(`select ${THREAD_COLS} from threads where kind = 'support' and a_id = $1`, [user.id]);
    return t ? { thread: t, side: 'a', staff: false } : { error: 'Не удалось открыть переписку', status: 500 };
  }
  const other = target.to || '';
  if (!/^[0-9a-f-]{36}$/.test(other) || other === user.id) return { error: 'Собеседник не найден', status: 404 };
  if (!(await canWrite(user.id, other))) return { error: 'Писать можно своим ученикам и репетиторам', status: 403 };
  const [a, b] = [user.id, other].sort();
  await q("insert into threads (id, kind, a_id, b_id) values ($1, 'direct', $2, $3) on conflict do nothing", [uid(), a, b]);
  const t = await one<Thread>(`select ${THREAD_COLS} from threads where kind = 'direct' and a_id = $1 and b_id = $2`, [a, b]);
  return t ? { thread: t, side: t.a_id === user.id ? 'a' : 'b', staff: false } : { error: 'Не удалось открыть переписку', status: 500 };
}

type MsgRow = { id: number; sender_id: string | null; text: string; files: MsgFile[] | null; created_at: Date; name: string | null };

function toMsg(user: Me, acc: Access, r: MsgRow): Msg {
  const mine = r.sender_id === user.id;
  const fromStaff = acc.thread.kind === 'support' && r.sender_id !== acc.thread.a_id;
  let author = r.name || 'Пользователь';
  if (fromStaff && !acc.staff) author = 'Поддержка';
  else if (fromStaff) author = `${author} · поддержка`;
  const m: Msg = { id: r.id, mine, author, text: r.text, at: iso(r.created_at) };
  if (Array.isArray(r.files) && r.files.length) m.files = r.files;
  return m;
}

/**
 * Сообщения переписки: новые после after (для обновления раз в несколько секунд)
 * или последние 100 до before (история). Заодно отмечаем прочитанное.
 */
export async function threadMessages(user: Me, acc: Access, opts: { after?: number; before?: number }) {
  const t = acc.thread;
  const sel = 'select m.id, m.sender_id, m.text, m.files, m.created_at, u.name from messages m left join users u on u.id = m.sender_id';
  const rows = opts.after
    ? await q<MsgRow>(`${sel} where m.thread_id = $1 and m.id > $2 order by m.id limit 200`, [t.id, opts.after])
    : (await q<MsgRow>(`${sel} where m.thread_id = $1 and ($2 = 0 or m.id < $2) order by m.id desc limit 100`, [t.id, opts.before || 0])).reverse();
  const last = rows.length ? rows[rows.length - 1].id : 0;
  const col = acc.side === 'a' ? 'a_read' : 'b_read';
  if (!opts.before && last > t[col]) await q(`update threads set ${col} = $2, ${col}_at = now() where id = $1 and ${col} < $2`, [t.id, last]);
  const seenAt = acc.side === 'a' ? t.b_read_at : t.a_read_at;
  return {
    messages: rows.map((r) => toMsg(user, acc, r)),
    // До какого сообщения дочитал собеседник и когда — чтобы показать «Прочитано в 14:05»
    seen: acc.side === 'a' ? t.b_read : t.a_read,
    seenAt: seenAt ? iso(seenAt) : null,
    more: !opts.after && rows.length === 100,
  };
}

type Posted = { id: number; created_at: Date; files: MsgFile[] | null };

/**
 * Новое сообщение. fileIds — файлы, которые человек заранее загрузил (POST /api/messages/files):
 * одним запросом проверяем, что они его и ещё ни к чему не прикреплены, сохраняем сообщение и привязываем файлы.
 */
export async function postMessage(user: Me, acc: Access, text: string, fileIds: string[], req: Request): Promise<Msg | { error: string; status: number }> {
  const t = acc.thread;
  const row = fileIds.length
    ? await one<Posted>(
        `with f as (
           select id, name, mime, size, w, h from message_files
            where id = any($4::text[]) and uploader_id = $2::text and message_id is null
            for update
         ), m as (
           insert into messages (thread_id, sender_id, text, files)
           select $1::text, $2::text, $3::text,
                  (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', id, 'name', name, 'mime', mime, 'size', size, 'w', w, 'h', h))
                                    order by array_position($4::text[], id)) from f)
            where (select count(*) from f) = cardinality($4::text[])
           returning id, created_at, files
         ), linked as (
           update message_files set thread_id = $1::text, message_id = (select id from m)
            where id in (select id from f) and exists (select 1 from m)
           returning id
         )
         select id, created_at, files from m`,
        [t.id, user.id, text, fileIds],
      )
    : await one<Posted>('insert into messages (thread_id, sender_id, text) values ($1, $2, $3) returning id, created_at, files', [t.id, user.id, text]);
  if (!row) {
    if (fileIds.length) return { error: 'Файл не найден — прикрепите его ещё раз', status: 400 };
    throw new Error('message not saved');
  }
  const col = acc.side === 'a' ? 'a_read' : 'b_read';
  await q(`update threads set last_at = now(), ${col} = greatest(${col}, $2), ${col}_at = now() where id = $1`, [t.id, row.id]);
  if (t.kind === 'support' && !acc.staff) logEvent('support', { user, req, dedupe: `support:${user.id}` });
  const files = Array.isArray(row.files) && row.files.length ? row.files : undefined;
  notifyByMail(user, acc, text || filesSummary(files), req);
  return { id: row.id, mine: true, author: user.name, text, at: iso(row.created_at), ...(files ? { files } : {}) };
}

/* ───────── Письмо о новом сообщении ───────── */

// Пишем только о первом непрочитанном сообщении и не чаще раза в полчаса на переписку
const mailed = new Map<string, number>();
const MAIL_GAP = 30 * 60e3;
const AWAY_MIN = 3;

function notifyByMail(sender: Me, acc: Access, text: string, req: Request) {
  if (!mailConfigured()) return;
  const t = acc.thread;
  const url = `${siteUrl(req)}/messages?t=${t.id}`;
  const quote = text.length > 400 ? `${text.slice(0, 400)}…` : text;
  const once = (key: string) => {
    const now = Date.now();
    if (now - (mailed.get(key) ?? 0) < MAIL_GAP) return false;
    if (mailed.size > 5000) mailed.clear();
    mailed.set(key, now);
    return true;
  };
  (async () => {
    const fresh = await one<Thread>(`select ${THREAD_COLS} from threads where id = $1`, [t.id]);
    if (!fresh) return;
    if (t.kind === 'support' && !acc.staff) {
      // Обращение в поддержку → администраторам
      const n = await one<{ n: number }>('select count(*)::int as n from messages where thread_id = $1 and id > $2 and sender_id = $3', [t.id, fresh.b_read, t.a_id]);
      const to = adminEmails().filter((e) => e !== sender.email.toLowerCase());
      if (n?.n !== 1 || !to.length || !once(`${t.id}:staff`)) return;
      const l = letter({ lines: [`${sender.name} (${sender.email}) написал(а) в поддержку «${BRAND.name}»:`], quote, button: { href: url, label: 'Ответить' } });
      await sendMail(to, `Поддержка: сообщение от ${sender.name}`, l.text, l.html);
      return;
    }
    // Личное сообщение или ответ поддержки → второму участнику, если его сейчас нет на сайте
    const toId = t.kind === 'support' ? t.a_id : acc.side === 'a' ? t.b_id : t.a_id;
    if (!toId || toId === sender.id) return;
    const read = toId === fresh.a_id ? fresh.a_read : fresh.b_read;
    const r = await one<{ email: string; notify_messages: boolean; away: boolean; n: number }>(
      `select u.email, u.notify_messages, (u.seen_at is null or u.seen_at < now() - make_interval(mins => $3)) as away,
              (select count(*) from messages m where m.thread_id = $2 and m.id > $4 and m.sender_id is distinct from $1)::int as n
         from users u where u.id = $1`,
      [toId, t.id, AWAY_MIN, read],
    );
    if (!r || !r.notify_messages || !r.away || r.n !== 1 || !once(`${t.id}:${toId}`)) return;
    const l =
      t.kind === 'support'
        ? letter({
            lines: ['Здравствуйте!', `Поддержка «${BRAND.name}» ответила на ваше сообщение:`],
            quote,
            button: { href: url, label: 'Открыть переписку' },
          })
        : letter({
            lines: ['Здравствуйте!', `${sender.name} написал(а) вам в «${BRAND.name}»:`],
            quote,
            button: { href: url, label: 'Ответить' },
            note: 'Мы пишем только о первом непрочитанном сообщении, чтобы не засорять почту.',
          });
    await sendMail(r.email, t.kind === 'support' ? `Ответ поддержки «${BRAND.name}»` : `Новое сообщение от ${sender.name}`, l.text, l.html);
  })().catch((e) => console.error('[Почта] Письмо о новом сообщении не отправлено:', mailErrorText(e)));
}
