import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/app/AppHeader';
import { Messenger } from '@/components/app/Messenger';
import { isAdmin } from '@/lib/admin';
import { getUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { mailConfigured } from '@/lib/mail';
import { ensureInviteCode, listContacts, listThreads, supportEnabled } from '@/lib/messages';
import { firstParams } from '@/lib/nav';

export const metadata: Metadata = { title: 'Сообщения' };

type Sp = Promise<Record<string, string | string[] | undefined>>;

export default async function MessagesPage({ searchParams }: { searchParams: Sp }) {
  const user = await getUser();
  const sp = await firstParams(searchParams);
  const open = { thread: sp.t, with: sp.with, support: sp.support === '1' };
  if (!user) {
    // Ссылка из письма («ответьте в переписке») должна открыть нужную переписку и после входа
    const back = new URLSearchParams();
    if (open.thread) back.set('t', open.thread);
    if (open.with) back.set('with', open.with);
    if (open.support) back.set('support', '1');
    redirect(`/login?next=${encodeURIComponent(`/messages${back.size ? `?${back}` : ''}`)}`);
  }
  const tutor = user.role === 'tutor';
  const [threads, contacts, invite, lessons] = await Promise.all([
    listThreads(user),
    listContacts(user),
    tutor ? ensureInviteCode(user.id) : null,
    // Ближайшие уроки — чтобы одной кнопкой вставить ссылку в сообщение
    tutor
      ? q<{ code: string; title: string; starts_at: Date | null }>(
          `select code, title, starts_at from lessons
            where owner_id = $1 and (starts_at is null or starts_at > now() - interval '2 hours')
            order by starts_at asc nulls last, created_at desc limit 10`,
          [user.id],
        )
      : [],
  ]);
  return (
    <div className="flex h-dvh flex-col bg-mist/60">
      <AppHeader user={user} active="messages" />
      <main className="wrap flex min-h-0 flex-1 flex-col max-sm:px-0 sm:py-6">
        <Messenger
          me={{ id: user.id, role: user.role, admin: isAdmin(user) }}
          initialThreads={threads}
          contacts={contacts}
          support={supportEnabled()}
          invite={invite}
          lessons={lessons.map((l) => ({ code: l.code, title: l.title, startsAt: l.starts_at ? new Date(l.starts_at).toISOString() : null }))}
          open={open}
          mail={mailConfigured()}
        />
      </main>
    </div>
  );
}
