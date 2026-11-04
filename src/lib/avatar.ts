// Фото профиля: адрес картинки с «версией» — после замены фото браузер сразу покажет новое.
export const avatarUrl = (id: string, at: Date | string | number | null | undefined) =>
  at ? `/api/avatar/${id}?v=${new Date(at).getTime().toString(36)}` : null;

/** Фото уменьшаем в браузере до 320×320; на сервер — не больше 300 КБ. */
export const AVATAR_SIZE = 320;
export const AVATAR_MAX = 300_000;
