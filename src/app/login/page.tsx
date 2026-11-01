import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { AuthForm } from '@/components/auth/AuthForm';
import { AuthShell } from '@/components/auth/AuthShell';
import { getUser } from '@/lib/auth';
import { inviter } from '@/lib/messages';
import { firstParams, safeNext } from '@/lib/nav';

export const metadata: Metadata = { title: 'Вход' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await firstParams(searchParams);
  const invite = typeof sp.invite === 'string' ? sp.invite : '';
  // Уже вошли — сразу туда, куда человек шёл (или в кабинет), а не на форму
  const user = await getUser();
  if (user) redirect(safeNext(sp.next) ?? (invite && user.role === 'student' ? `/invite/${encodeURIComponent(invite)}` : '/dashboard'));
  const tutor = invite ? await inviter(invite) : null;
  return (
    <AuthShell
      title="Вход в кабинет"
      text={tutor ? `Войдите — и ${tutor.name} появится в вашем кабинете.` : 'Уроки, сообщения, конспекты и ИИ-помощник — после входа.'}
    >
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
    </AuthShell>
  );
}
