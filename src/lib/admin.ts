import type { User } from './auth';

/** Почты администраторов из ADMIN_EMAILS (через запятую, пробел или точку с запятой). */
export const adminEmails = () =>
  (process.env.ADMIN_EMAILS || '')
    .toLowerCase()
    .split(/[\s,;]+/)
    .filter(Boolean);

export const isAdmin = (user: Pick<User, 'email'> | null | undefined) => Boolean(user && adminEmails().includes(user.email.toLowerCase()));
