import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { AuthForm } from '@/components/auth/AuthForm';
import { AuthShell } from '@/components/auth/AuthShell';
import { getUser } from '@/lib/auth';
import { inviter } from '@/lib/messages';
import { firstParams, safeNext } from '@/lib/nav';

export const metadata: Metadata = { title: 'Регистрация' };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await firstParams(searchParams);
  const invite = typeof sp.invite === 'string' ? sp.invite : '';
  // Уже вошли — сразу туда, куда человек шёл (или в кабинет), а не на форму
  const user = await getUser();
  if (user) redirect(safeNext(sp.next) ?? (invite && user.role === 'student' ? `/invite/${encodeURIComponent(invite)}` : '/dashboard'));
  const tutor = invite ? await inviter(invite) : null;
  return (
    <AuthShell
      title="Регистрация"
      text={
        tutor
          ? `Вас пригласил(а) ${tutor.name}. После регистрации репетитор появится в вашем кабинете — можно будет переписываться.`
          : 'Репетиторам — уроки с видео, доской и перепиской с учениками. Ученикам — уроки, конспекты и ИИ-помощник.'
      }
    >
      <Suspense>
        <AuthForm mode="register" />
      </Suspense>
    </AuthShell>
  );
}
