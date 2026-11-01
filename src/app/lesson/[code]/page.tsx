import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LessonClient } from '@/components/room/LessonClient';
import { aiConfigured } from '@/lib/ai';
import { getUser } from '@/lib/auth';
import { lessonByCode } from '@/lib/lessons';
import { livekitConfigured } from '@/lib/livekit';
import { og } from '@/lib/og';

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lesson = await lessonByCode((await params).code);
  if (!lesson) return { title: 'Урок не найден', robots: { index: false } };
  const description = 'Ссылка на онлайн-урок: видеосвязь, общая доска и чат прямо в браузере, без установки программ.';
  return { title: lesson.title, description, robots: { index: false }, openGraph: og(`Урок «${lesson.title}»`, description) };
}

export default async function LessonPage({ params }: Props) {
  const lesson = await lessonByCode((await params).code);
  if (!lesson) notFound();
  const user = await getUser();
  return (
    <LessonClient
      lesson={{ code: lesson.code, title: lesson.title, subject: lesson.subject, tutor: lesson.owner_name }}
      user={user ? { name: user.name, isOwner: user.id === lesson.owner_id } : null}
      livekit={livekitConfigured()}
      ai={aiConfigured()}
    />
  );
}
