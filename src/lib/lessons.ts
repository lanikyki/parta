import { one } from './db';
import { isLessonCode } from './ids';

export type Lesson = {
  id: string;
  code: string;
  title: string;
  subject: string | null;
  kind: 'individual' | 'group';
  starts_at: Date | null;
  duration_min: number;
  owner_id: string;
  owner_name: string;
  summary: string | null;
  summary_at: Date | null;
  created_at: Date;
};

export async function lessonByCode(code: string) {
  if (!isLessonCode(code)) return null;
  return one<Lesson>(
    `select l.*, u.name as owner_name from lessons l join users u on u.id = l.owner_id where l.code = $1`,
    [code],
  );
}

export { clientIp } from './http';
