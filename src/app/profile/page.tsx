import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccountShell } from '@/components/app/AccountShell';
import { ProfileForm } from '@/components/app/ProfileForm';
import { getUser } from '@/lib/auth';
import { avatarUrl } from '@/lib/avatar';
import { one } from '@/lib/db';
import { fmtPhone } from '@/lib/phone';

export const metadata: Metadata = { title: 'Профиль' };

export default async function ProfilePage() {
  const user = await getUser();
  if (!user) redirect('/login?next=/profile');
  const u = await one<{ subjects: string | null; about: string | null; phone: string | null }>('select subjects, about, phone from users where id = $1', [user.id]);
  return (
    <AccountShell user={user} active="profile" title="Профиль">
      <ProfileForm
        data={{
          tutor: user.role === 'tutor',
          name: user.name,
          email: user.email,
          avatar: user.avatar_at ? avatarUrl(user.id, user.avatar_at) : null,
          subjects: u?.subjects ?? '',
          about: u?.about ?? '',
          grade: user.grade ?? '',
          phone: u?.phone ? fmtPhone(u.phone) : null,
        }}
      />
    </AccountShell>
  );
}
