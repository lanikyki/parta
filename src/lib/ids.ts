import crypto from 'node:crypto';

export const uid = () => crypto.randomUUID();

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Код урока в стиле «kfz-82m-qpx» — его видно в ссылке-приглашении. */
export function lessonCode() {
  const bytes = crypto.randomBytes(9);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${s.slice(0, 3)}-${s.slice(3, 6)}-${s.slice(6, 9)}`;
}

export const isLessonCode = (s: string) => /^[a-z2-9]{3}-[a-z2-9]{3}-[a-z2-9]{3}$/.test(s);

/** Код ссылки-приглашения репетитора: /invite/k3m9qpxa */
export function inviteCode() {
  let s = '';
  for (const b of crypto.randomBytes(8)) s += ALPHABET[b % ALPHABET.length];
  return s;
}

export const isInviteCode = (s: string) => /^[a-z2-9]{8}$/.test(s);
