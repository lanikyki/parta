import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthForm } from '@/components/auth/AuthForm';
import { AuthShell } from '@/components/auth/AuthShell';
import { inviter } from '@/lib/messages';

export const metadata: Metadata = { title: 'Регистрация' };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const tutor = sp.invite ? await inviter(sp.invite) : null;
  return (
    <AuthShell
      title="Регистрация"
      text={
        tutor
          ? `Вас пригласил(а) ${tutor.name}. После регистрации репетитор появится в вашем кабинете — можно будет переписываться.`
          : 'Репетиторам — уроки с видео, доской и перепиской с учениками. Ученикам — уроки, конспекты и ИИ-помощник.'
      }
    >
      <Suspense>
        <AuthForm mode="register" />
      </Suspense>
    </AuthShell>
  );
}
