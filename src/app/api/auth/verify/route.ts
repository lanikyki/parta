import { createSession } from '@/lib/auth';
import { gradeLabel } from '@/lib/brand';
import { acceptInvite } from '@/lib/messages';
import { clearRegOwner, isRegOwner } from '@/lib/authflow';
import { checkCode } from '@/lib/codes';
import { one, q } from '@/lib/db';
import { logEvent } from '@/lib/events';
import { body, clientIp, fail, json, rateLimit, str } from '@/lib/http';
import { uid } from '@/lib/ids';
import { clearRefCookie } from '@/lib/referral';

type Pending = { role?: string; name?: string; grade?: string | null; password_hash?: string; owner?: string; invite?: string; ref?: string };

/** Шаг 2 регистрации: верный код из письма → создаём аккаунт и входим. */
export async function POST(req: Request) {
  if (!rateLimit(`verify:${clientIp(req)}`, 40, 15 * 60e3)) return fail('Слишком много попыток, подождите 15 минут', 429);
  const b = await body<{ email: string; code: string }>(req);
  const email = str(b.email, 120).toLowerCase();
  // Код подойдёт только в том браузере, где заполняли анкету
  const pending = await one<{ payload: string | null }>("select payload from email_codes where email = $1 and purpose = 'register'", [email]);
  let owner: unknown;
  try {
    owner = pending?.payload ? (JSON.parse(pending.payload) as Pending).owner : undefined;
  } catch {
    owner = undefined;
  }
  if (pending && !(await isRegOwner(owner)))
    return Response.json({ error: 'Регистрацию начинали в другом браузере. Заполните анкету ещё раз здесь.', gone: true }, { status: 400 });
  const r = await checkCode(email, 'register', str(b.code, 20));
  if (!r.ok) return Response.json({ error: r.error, gone: r.gone ?? false }, { status: 400 });
  const p = (r.payload || {}) as Pending;
  if (!p.name || !p.password_hash) return fail('Данные регистрации потерялись — заполните анкету ещё раз', 400);
  if (await one('select 1 from users where email = $1', [email])) return fail('Этот email уже зарегистрирован — просто войдите', 409);
  const id = uid();
  const role = p.role === 'tutor' ? 'tutor' : 'student';
  await q('insert into users (id, role, name, email, password_hash, grade) values ($1, $2, $3, $4, $5, $6)', [
    id,
    role,
    p.name,
    email,
    p.password_hash,
    role === 'student' ? p.grade || null : null,
  ]);
  await createSession(id);
  await clearRegOwner();
  logEvent('register', {
    user: { id, name: p.name },
    detail: `${role === 'tutor' ? 'Репетитор' : 'Ученик'}${role === 'student' && p.grade ? `, ${gradeLabel(p.grade).toLowerCase()}` : ''} · ${email}`,
    req,
  });
  // Пришёл по ссылке-приглашению репетитора — сразу добавляем в его ученики
  if (p.invite) await acceptInvite({ id, name: p.name, role }, p.invite, req);
  // Пришёл по реферальной ссылке коллеги — запоминаем, кто пригласил
  if (role === 'tutor' && typeof p.ref === 'string' && p.ref !== id) {
    const ref = await one<{ name: string }>("select name from users where id = $1 and role = 'tutor'", [p.ref]);
    if (ref) {
      await q('update users set referred_by = $2 where id = $1', [id, p.ref]);
      logEvent('referral_join', { user: { id, name: p.name }, detail: `пригласил(а) ${ref.name}`, req });
    }
  }
  await clearRefCookie();
  return json({ ok: true });
}
