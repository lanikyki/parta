import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';
import { AcceptInvite, InviteLink } from '@/components/app/InviteLink';
import { getUser } from '@/lib/auth';
import { one } from '@/lib/db';
import { inviter } from '@/lib/messages';
import { og } from '@/lib/og';

type Props = { params: Promise<{ code: string }> };

// Превью ссылки в мессенджере: «Анна Смирнова приглашает вас на занятия»
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tutor = await inviter((await params).code);
  const description = 'Видеоурок, общая доска и переписка с репетитором — прямо в браузере, без установки программ.';
  return {
    title: 'Приглашение',
    description,
    robots: { index: false },
    openGraph: og(tutor ? `${tutor.name} приглашает вас на занятия` : 'Приглашение на занятия', description),
  };
}

export default async function InvitePage({ params }: Props) {
  const code = (await params).code;
  const [tutor, user] = await Promise.all([inviter(code), getUser()]);

  if (!tutor)
    return (
      <AuthShell title="Ссылка не работает" text="Возможно, в ней опечатка или её скопировали не полностью. Попросите репетитора прислать ссылку ещё раз.">
        <Link href="/" className="btn btn-line btn-lg w-full">
          На главную
        </Link>
      </AuthShell>
    );

  const chat = `/messages?with=${tutor.id}`;

  if (user?.id === tutor.id)
    return (
      <AuthShell
        title="Это ваша ссылка-приглашение"
        text="Отправьте её ученикам в мессенджер или по почте. Ученик зарегистрируется по ней — и сразу появится у вас в кабинете: можно будет переписываться и отправлять ссылки на уроки."
      >
        <div className="grid gap-3">
          <InviteLink code={code} className="btn-lg w-full" />
          <Link href="/dashboard" className="btn btn-line btn-lg w-full">
            В кабинет
          </Link>
        </div>
      </AuthShell>
    );

  if (user?.role === 'tutor')
    return (
      <AuthShell title={`${tutor.name} приглашает учеников`} text="Вы вошли как репетитор, а это приглашение для учеников. Откройте ссылку в аккаунте ученика или отправьте её ученику.">
        <Link href="/dashboard" className="btn btn-line btn-lg w-full">
          В кабинет
        </Link>
      </AuthShell>
    );

  if (user) {
    const linked = await one('select 1 from contacts where tutor_id = $1 and student_id = $2', [tutor.id, user.id]);
    return linked ? (
      <AuthShell title="Вы уже занимаетесь у этого репетитора" text={`${tutor.name} — в вашем кабинете. Можно написать прямо сейчас.`}>
        <Link href={chat} className="btn btn-primary btn-lg w-full">
          Написать
        </Link>
      </AuthShell>
    ) : (
      <AuthShell
        title={`${tutor.name} приглашает вас заниматься`}
        text="Примите приглашение — репетитор появится в вашем кабинете. Можно будет переписываться, получать ссылки на уроки и конспекты."
      >
        <AcceptInvite code={code} />
      </AuthShell>
    );
  }

  const next = encodeURIComponent(chat);
  return (
    <AuthShell
      title={`${tutor.name} приглашает вас заниматься`}
      text="Зарегистрируйтесь — это бесплатно и займёт минуту. Репетитор появится в вашем кабинете: можно переписываться, получать ссылки на уроки и конспекты."
    >
      <div className="grid gap-3">
        <Link href={`/register?role=student&invite=${code}&next=${next}`} className="btn btn-primary btn-lg w-full">
          Зарегистрироваться
        </Link>
        <Link href={`/login?invite=${code}&next=${next}`} className="btn btn-line btn-lg w-full">
          У меня уже есть аккаунт
        </Link>
        <p className="mt-2 text-center text-[14px] text-ink-3">На урок можно попасть и без регистрации — по ссылке на урок от репетитора.</p>
      </div>
    </AuthShell>
  );
}
