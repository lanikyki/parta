import { getUser } from '@/lib/auth';
import { referrerByCode, setRefCookie } from '@/lib/referral';

const go = (to: string) => new Response(null, { status: 303, headers: { location: to, 'cache-control': 'no-store' } });

/** Реферальная ссылка: запоминаем, кто пригласил (на 60 дней), и открываем главную страницу. */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toLowerCase();
  const ref = await referrerByCode(code);
  if (!ref) return go('/');
  const user = await getUser();
  if (user?.id === ref.id) return go('/referral?self=1');
  if (user) return go('/dashboard');
  await setRefCookie(code);
  return go('/?ref=1');
}
