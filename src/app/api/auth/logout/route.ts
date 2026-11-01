import { destroySession, getUser } from '@/lib/auth';
import { logEvent } from '@/lib/events';

export async function POST(req: Request) {
  const user = await getUser();
  await destroySession();
  if (user) logEvent('logout', { user, req });
  // Относительный адрес: за прокси или туннелем req.url может указывать на localhost
  return new Response(null, { status: 303, headers: { location: '/' } });
}
