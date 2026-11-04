import { cookies } from 'next/headers';
import { httpsNow } from './auth';
import { one, q } from './db';
import { inviteCode, isInviteCode } from './ids';

// Реферальная программа: репетитор делится ссылкой /r/код. Коллега, который зарегистрируется по ней,
// получит скидку 10% на первую оплату, а пригласившему достанется 20% с каждой оплаты коллеги — бонусами.

export const REF_COOKIE = 'parta_ref';
const REF_DAYS = 60;

export async function ensureRefCode(userId: string) {
  for (let i = 0; i < 5; i++) {
    const row = await one<{ ref_code: string | null }>('select ref_code from users where id = $1', [userId]);
    if (!row || row.ref_code) return row?.ref_code ?? null;
    try {
      await q('update users set ref_code = $2 where id = $1 and ref_code is null', [userId, inviteCode()]);
    } catch (e) {
      if (!/unique|duplicate/i.test(String((e as Error).message))) throw e;
    }
  }
  return null;
}

export const referrerByCode = async (code: string) =>
  isInviteCode(code) ? one<{ id: string; name: string }>("select id, name from users where ref_code = $1 and role = 'tutor'", [code]) : null;

/** Кто пригласил (по cookie после перехода по ссылке /r/код). */
export async function refFromCookie() {
  const code = (await cookies()).get(REF_COOKIE)?.value || '';
  return code ? referrerByCode(code) : null;
}

export async function setRefCookie(code: string) {
  const https = await httpsNow();
  (await cookies()).set(REF_COOKIE, code, { httpOnly: true, sameSite: 'lax', secure: https, path: '/', maxAge: REF_DAYS * 864e2 });
}

export async function clearRefCookie() {
  const jar = await cookies();
  if (jar.get(REF_COOKIE)) jar.set(REF_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
}

export type RefRow = { name: string; joined: Date; paid: number; earned: number; pending: number };

/** Сколько коллег пришло по ссылке, сколько оплатили и сколько бонусов это принесло. */
export async function referralStats(userId: string) {
  const people = await q<RefRow>(
    `select u.name, u.created_at as joined,
            (select count(*) from payments p where p.user_id = u.id and p.status in ('succeeded', 'refunded') and p.amount_kop > 0)::int as paid,
            coalesce((select sum(b.amount_kop) from bonus_ledger b where b.user_id = $1 and b.from_user = u.id and b.kind = 'referral'
                        and b.canceled_at is null and b.available_at <= now()), 0)::int as earned,
            coalesce((select sum(b.amount_kop) from bonus_ledger b where b.user_id = $1 and b.from_user = u.id and b.kind = 'referral'
                        and b.canceled_at is null and b.available_at > now()), 0)::int as pending
       from users u where u.referred_by = $1 order by u.created_at desc limit 200`,
    [userId],
  );
  return {
    people,
    invited: people.length,
    paying: people.filter((p) => p.paid > 0).length,
    earned: people.reduce((n, p) => n + p.earned, 0),
    pending: people.reduce((n, p) => n + p.pending, 0),
  };
}
