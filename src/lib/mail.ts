import nodemailer, { type Transporter } from 'nodemailer';
import { BRAND } from './brand';

// Отправка писем через обычный почтовый ящик (Яндекс, Mail.ru, Gmail и любой SMTP).
// Та же логика есть в scripts/check.mjs (smtpConf) — меняйте вместе.

type Smtp = { host: string; port: number; secure: boolean; user: string; pass: string; from: string; fixed?: boolean; requireTLS?: boolean };

const clean = (v: string | undefined) => (v || '').trim().replace(/^["']|["']$/g, '').trim();

/** Адрес сервера по домену почты — чтобы не искать его в справке. */
const KNOWN_HOSTS: [RegExp, string][] = [
  [/@(yandex\.(ru|com|by|kz|ua)|ya\.ru|narod\.ru)$/i, 'smtp.yandex.ru'],
  [/@(mail\.ru|inbox\.ru|list\.ru|bk\.ru|internet\.ru)$/i, 'smtp.mail.ru'],
  [/@(gmail|googlemail)\.com$/i, 'smtp.gmail.com'],
  [/@(rambler\.ru|lenta\.ru|autorambler\.ru|myrambler\.ru|ro\.ru)$/i, 'smtp.rambler.ru'],
];

export function smtpConf(): Smtp | null {
  const user = clean(process.env.SMTP_USER);
  let pass = clean(process.env.SMTP_PASS);
  let host = clean(process.env.SMTP_HOST).replace(/^smtps?:\/\//i, '');
  let port = Number(clean(process.env.SMTP_PORT)) || 0;
  const hp = host.match(/^([^:/]+):(\d+)/);
  if (hp) [host, port] = [hp[1], port || Number(hp[2])];
  host = host.replace(/[/].*$/, '') || KNOWN_HOSTS.find(([re]) => re.test(user))?.[1] || '';
  if (!user || !pass || !host) return null;
  const fixed = port > 0 || Boolean(clean(process.env.SMTP_SECURE)); // порт указан явно — запасной не пробуем
  port ||= 465;
  const sec = clean(process.env.SMTP_SECURE);
  const secure = sec ? !/^(0|false|no|нет)$/i.test(sec) : port === 465;
  if (/gmail/i.test(host)) pass = pass.replace(/\s+/g, ''); // Gmail показывает пароль приложения с пробелами
  const fromEnv = clean(process.env.MAIL_FROM);
  const from = fromEnv.includes('@') ? fromEnv : `${fromEnv || BRAND.name} <${user}>`;
  return { host, port, secure, user, pass, from, fixed };
}

export const mailConfigured = () => smtpConf() !== null;

let cached: { sig: string; t: Transporter } | null = null;
function transporter(c: Smtp) {
  const sig = JSON.stringify([c.host, c.port, c.secure, c.user, c.pass]);
  if (cached?.sig !== sig) {
    const t = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      requireTLS: c.requireTLS,
      auth: { user: c.user, pass: c.pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
    cached = { sig, t };
  }
  return cached.t;
}

const netError = (e: unknown) => {
  const err = e as { code?: string; message?: string } | null;
  return /ETIMEDOUT|ECONNECTION|ESOCKET|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|timeout/i.test(`${err?.code ?? ''} ${err?.message ?? ''}`);
};

// Порт 465 иногда закрывает антивирус, VPN или провайдер — тогда пробуем 587 и запоминаем, какой сработал
let preferAlt = false;
const altOf = (c: Smtp): Smtp | null => (!c.fixed && c.port === 465 ? { ...c, port: 587, secure: false, requireTLS: true } : null);

async function viaSmtp<T>(c: Smtp, run: (t: Transporter) => Promise<T>): Promise<T> {
  const alt = altOf(c);
  const order = alt ? (preferAlt ? [alt, c] : [c, alt]) : [c];
  let first: unknown = null;
  for (const conf of order) {
    try {
      const out = await run(transporter(conf));
      preferAlt = conf === alt;
      return out;
    } catch (e) {
      if (!netError(e)) throw e; // неверный пароль и т. п. — другой порт не поможет
      first ??= e;
    }
  }
  throw first;
}

/** Понятная причина, почему письмо не ушло. */
export function mailErrorText(e: unknown) {
  const err = e as { code?: string; responseCode?: number; response?: string; message?: string } | null;
  const code = String(err?.code || '');
  const resp = String(err?.response || err?.message || e);
  if (/access rights to this service/i.test(resp))
    return 'Яндекс не пускает программы к этому ящику: в Яндекс Почте откройте ⚙ → «Все настройки» → «Почтовые программы» и включите IMAP и «Пароли приложений и OAuth-токены»';
  if (code === 'EAUTH' || err?.responseCode === 535 || err?.responseCode === 534)
    return 'неверный логин или пароль почты (SMTP_USER, SMTP_PASS). Для Яндекса, Mail.ru и Gmail нужен «пароль приложения», а не обычный пароль от почты';
  if (err?.responseCode === 553 || /sender address rejected|not owned/i.test(resp))
    return 'почта не разрешает отправлять от этого адреса — оставьте MAIL_FROM пустым (письма пойдут от SMTP_USER)';
  if (code === 'EDNS' || /ENOTFOUND|EAI_AGAIN/.test(resp)) return 'адрес почтового сервера SMTP_HOST не найден — проверьте, нет ли опечатки';
  if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED'].includes(code) || /timeout|ECONNREFUSED|ECONNRESET/i.test(resp))
    return 'нет связи с почтовым сервером — проверьте интернет, SMTP_HOST и SMTP_PORT. Часто почту не пропускает VPN, антивирус или провайдер';
  if (/certificate|self.signed|CERT/i.test(resp)) return 'ошибка сертификата почтового сервера (так бывает, когда антивирус проверяет защищённые соединения)';
  if (err?.responseCode && err.responseCode >= 500) return `почтовый сервер отклонил письмо: ${resp.slice(0, 160)}`;
  return resp.slice(0, 200);
}

/** Проверка подключения к почте (для npm run check и админки). */
export async function verifyMail() {
  const c = smtpConf();
  if (!c) return false;
  await viaSmtp(c, (t) => t.verify());
  return true;
}

/** Отправляет любое письмо. Возвращает false, если почта не настроена. */
export async function sendMail(to: string | string[], subject: string, text: string, html?: string) {
  const c = smtpConf();
  if (!c) return false;
  await viaSmtp(c, (t) => t.sendMail({ from: c.from, to, subject, text, html }));
  return true;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** Простое письмо в стиле сайта: абзацы текста, выделенный блок и кнопка. */
export function letter(parts: { lines: string[]; quote?: string; button?: { href: string; label: string }; note?: string }) {
  const p = (t: string) => `<p style="font-size:16px;margin:0 0 12px">${esc(t)}</p>`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f1f1a">
<p style="font-size:20px;font-weight:bold;color:#12a566;margin:0 0 16px">${BRAND.name}</p>
${parts.lines.map(p).join('\n')}
${parts.quote ? `<p style="font-size:16px;background:#e6f6ee;color:#0a3d2a;border-radius:12px;padding:12px 16px;margin:0 0 16px;white-space:pre-wrap">${esc(parts.quote)}</p>` : ''}
${parts.button ? `<p style="margin:0 0 16px"><a href="${esc(parts.button.href)}" style="display:inline-block;background:#12a566;color:#fff;text-decoration:none;font-weight:bold;border-radius:10px;padding:12px 20px">${esc(parts.button.label)}</a></p>` : ''}
${parts.note ? `<p style="font-size:14px;color:#4b5d56;margin:0">${esc(parts.note)}</p>` : ''}
</div>`;
  const text = [...parts.lines, parts.quote ? `«${parts.quote}»` : '', parts.button ? `${parts.button.label}: ${parts.button.href}` : '', parts.note || '']
    .filter(Boolean)
    .join('\n\n');
  return { text, html };
}

const PURPOSE = {
  register: { subject: 'код подтверждения почты', lead: 'Вы регистрируетесь на сайте', ignore: 'Если вы не регистрировались, просто удалите это письмо.' },
  reset: { subject: 'код для смены пароля', lead: 'Вы меняете пароль на сайте', ignore: 'Если вы не меняли пароль, просто удалите это письмо — ваш пароль останется прежним.' },
} as const;

/**
 * Отправляет письмо с кодом. Если почта не настроена — печатает код в окне сервера
 * и возвращает false (на своём компьютере код покажется и на странице).
 */
export async function sendCode(email: string, code: string, purpose: keyof typeof PURPOSE) {
  const p = PURPOSE[purpose];
  if (!mailConfigured()) {
    console.log(`\n[Почта] Почта не настроена (SMTP_USER и SMTP_PASS в .env.local), письмо не отправлено.\n        Код для ${email}: ${code}\n`);
    return false;
  }
  const text = `Здравствуйте!\n\n${p.lead} «${BRAND.name}». Ваш код: ${code}\n\nКод действует 15 минут. Никому его не сообщайте.\n${p.ignore}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f1f1a">
<p style="font-size:20px;font-weight:bold;color:#12a566;margin:0 0 16px">${BRAND.name}</p>
<p style="font-size:16px;margin:0 0 12px">Здравствуйте!</p>
<p style="font-size:16px;margin:0 0 16px">${p.lead} «${BRAND.name}». Ваш код:</p>
<p style="font-size:34px;font-weight:bold;letter-spacing:8px;background:#e6f6ee;color:#0a6342;border-radius:12px;padding:14px 0;text-align:center;margin:0 0 16px">${code}</p>
<p style="font-size:14px;color:#4b5d56;margin:0 0 8px">Код действует 15 минут. Никому его не сообщайте.</p>
<p style="font-size:14px;color:#4b5d56;margin:0">${p.ignore}</p>
</div>`;
  return sendMail(email, `${code} — ${p.subject}`, text, html);
}
