import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthForm } from '@/components/auth/AuthForm';
import { AuthShell } from '@/components/auth/AuthShell';
import { inviter } from '@/lib/messages';

export const metadata: Metadata = { title: 'Вход' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const tutor = sp.invite ? await inviter(sp.invite) : null;
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
