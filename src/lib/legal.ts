// Реквизиты исполнителя (ИП) для оферты, политики конфиденциальности и контактов.
// Заполните в .env на сервере: LEGAL_NAME, LEGAL_INN, LEGAL_OGRNIP, LEGAL_EMAIL, LEGAL_PHONE, LEGAL_ADDRESS (см. README).

const env = (k: string) => (process.env[k] || '').trim().replace(/^["']|["']$/g, '');

export function legal() {
  const name = env('LEGAL_NAME');
  return {
    /** «ИП Иванова Анна Сергеевна» */
    name: name || 'ИП (ФИО будет указано)',
    inn: env('LEGAL_INN'),
    ogrnip: env('LEGAL_OGRNIP'),
    email: env('LEGAL_EMAIL') || env('SUPPORT_EMAIL') || (process.env.ADMIN_EMAILS || '').split(',')[0]?.trim() || '',
    phone: env('LEGAL_PHONE'),
    address: env('LEGAL_ADDRESS'),
    /** Реквизиты заполнены — можно принимать оплату */
    filled: Boolean(name && env('LEGAL_INN') && env('LEGAL_OGRNIP')),
    /** Дата редакции документов */
    updated: env('LEGAL_UPDATED') || '4 ноября 2026',
  };
}
export type Legal = ReturnType<typeof legal>;

/**
 * Редакция текста согласия на обработку персональных данных (страница /legal/consent).
 * Поменяли текст согласия — поменяйте и дату: у каждого пользователя в базе хранится редакция, на которую он согласился.
 */
export const CONSENT_VERSION = '18 ноября 2026';
