// Проверка настроек сайта: видео (LiveKit), ИИ-помощник, почта и админка.
// Запуск: npm run check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Читает .env.local так же, как сайт: KEY=VALUE, # — комментарии. */
export function readEnv(file = path.join(ROOT, '.env.local')) {
  if (!fs.existsSync(file)) return null;
  const env = {};
  for (const raw of fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '').trim();
    env[m[1]] = v;
  }
  return env;
}

/** Записывает KEY=value в файл настроек: меняет существующую строку или добавляет новую. */
export function setEnvValue(file, key, value) {
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const re = new RegExp(`^(\uFEFF?)[ \\t]*(?:export\\s+)?${key}[ \\t]*=.*$`, 'm');
  if (re.test(text)) text = text.replace(re, (_, bom) => `${bom}${key}=${value}`);
  else text += `${text && !text.endsWith('\n') ? eol : ''}${key}=${value}${eol}`;
  fs.writeFileSync(file, text);
}

/**
 * После обновления проекта дописывает в файл настроек новые строки из .env.example
 * (вместе с пояснениями). Уже существующие строки, даже закомментированные, не трогает.
 */
export function addNewSettings(file, example = path.join(ROOT, '.env.example')) {
  if (!fs.existsSync(file) || !fs.existsSync(example)) return [];
  const text = fs.readFileSync(file, 'utf8');
  const has = (k) => new RegExp(`^\uFEFF?[ \\t]*#?[ \\t]*(?:export\\s+)?${k}[ \\t]*=`, 'm').test(text);
  const out = [];
  const added = [];
  let section = '';
  let sectionShown = false;
  let notes = [];
  for (const line of fs.readFileSync(example, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const t = line.trim();
    if (/^#\s*---.*---$/.test(t)) {
      section = line;
      sectionShown = false;
      notes = [];
    } else if (!t) notes = [];
    else if (!/^[A-Z_][A-Z0-9_]*=/.test(t)) notes.push(line);
    else {
      const key = t.slice(0, t.indexOf('='));
      if (!has(key)) {
        if (section && !sectionShown) out.push('', section);
        sectionShown = true;
        out.push(...notes, line);
        added.push(key);
      }
      notes = [];
    }
  }
  if (!added.length) return [];
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(file, text + (text && !text.endsWith('\n') ? eol : '') + out.join(eol) + eol);
  return added;
}

const log = {
  ok: (s) => console.log(`  [OK] ${s}`),
  bad: (s) => console.log(`  [!!] ${s}`),
  skip: (s) => console.log(`  [--] ${s}`),
  info: (s) => console.log(`       ${s}`),
};

const reason = (e) => {
  const c = e?.cause?.code || e?.code || '';
  if (e?.name === 'TimeoutError' || /timeout/i.test(String(e?.message))) return 'нет ответа (таймаут)';
  if (c === 'ECONNREFUSED') return 'сервер не запущен (соединение отклонено)';
  if (c === 'ENOTFOUND' || c === 'EAI_AGAIN') return 'адрес не найден — проверьте, нет ли опечатки';
  if (c === 'CERT_HAS_EXPIRED' || /certificate/i.test(String(e?.cause?.message))) return 'проблема с сертификатом https';
  return e?.cause?.message || e?.message || String(e);
};

const errText = (t) => {
  try {
    const j = JSON.parse(t);
    return String(j?.error?.message || j?.message || j?.error || t).slice(0, 200);
  } catch {
    return String(t).replace(/\s+/g, ' ').slice(0, 200) || 'без текста';
  }
};

const isLocal = (u) => /\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(u);

export async function checkVideo(env) {
  const url = env.LIVEKIT_URL;
  if (!url || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    log.skip('Видео выключено: в .env.local не заполнены LIVEKIT_URL, LIVEKIT_API_KEY и LIVEKIT_API_SECRET.');
    return false;
  }
  const httpUrl = url.replace(/^ws(s?):\/\//, 'http$1://');
  try {
    const { RoomServiceClient } = await import('livekit-server-sdk');
    const svc = new RoomServiceClient(httpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
    await Promise.race([svc.listRooms(), new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), 8000))]);
    log.ok(`Видео: сервер LiveKit работает (${url}).`);
    return true;
  } catch (e) {
    const msg = String(e?.message || e);
    if (/401|403|unauthori[sz]ed|permission|invalid token|signature/i.test(msg)) {
      log.bad('Видео: сервер отвечает, но ключи не подходят. Проверьте LIVEKIT_API_KEY и LIVEKIT_API_SECRET.');
    } else if (isLocal(url)) {
      log.bad(`Видео: видеосервер не запущен (${url}).`);
      log.info('Запустите его в отдельном окне: livekit-server --dev (в Windows: livekit-server.exe --dev)');
      log.info('или запускайте всё сразу: npm run dev:all (в Windows — двойной щелчок по start-windows.bat).');
    } else {
      log.bad(`Видео: не удалось подключиться к ${url} — ${reason(e)}.`);
    }
    return false;
  }
}

const stripThink = (s) => String(s || '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();

function suggest(models) {
  const pick = (list, res) => {
    for (const re of res) {
      const m = list.find((id) => re.test(id));
      if (m) return m;
    }
    return '';
  };
  // Так же выбирает сайт (src/lib/ai.ts: SMART_RE, FAST_RE) — меняйте вместе.
  // Для быстрых ответов «думающие» модели (r1, qwq, thinking) не берём — они молчат по минуте.
  const smart = pick(models, [/deepseek.*v4.*pro/i, /deepseek.*v4/i, /deepseek.*(v3|chat)/i, /qwen.*(max|plus|235b|397b)/i, /deepseek/i, /qwen/i, /gpt-?[45]/i]) || models[0] || '';
  const thinking = /(^|[^a-z0-9])(r1|qwq)([^a-z0-9]|$)|think|reason/i;
  const rest = models.filter((id) => id !== smart && !thinking.test(id));
  const fast = pick(rest, [/flash|turbo|instant|lite|mini|haiku|nano/i, /deepseek.*chat/i, /qwen.*\D(7|8|14|27|30|32)b/i, /qwen/i]);
  return { smart, fast: fast || smart };
}

/**
 * Адрес и ключ ИИ с прощением частых ошибок — так же, как на сайте (src/lib/ai.ts: conf, apiBases).
 * Понимает и строку подключения new-api целиком: {"_type":"newapi_channel_conn","key":"sk-…","url":"https://…"}
 */
export function aiConf(env) {
  let key = String(env.AI_API_KEY || '').trim();
  let base = String(env.AI_BASE_URL || '').trim();
  for (const v of [key, base]) {
    if (!v.startsWith('{')) continue;
    try {
      const j = JSON.parse(v);
      if (typeof j?.key === 'string') key = j.key;
      if (typeof j?.url === 'string' && (!base || base.startsWith('{'))) base = j.url;
    } catch {}
  }
  key = key.replace(/^bearer\s+/i, '').replace(/^["'\s]+|["'\s]+$/g, '');
  if (/\s/.test(key)) key = key.match(/sk-[\w-]{16,}/)?.[0] ?? key.replace(/\s+/g, '');
  base = base.replace(/^["'\s]+|["'\s]+$/g, '').replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  return { key, base };
}

export function apiBases(base) {
  try {
    const u = new URL(base);
    const p = u.pathname.replace(/\/+$/, '');
    const asIs = u.origin + p;
    const v1 = `${u.origin}/v1`;
    if (!p) return [v1, asIs];
    if (/\/v\d+$/.test(p)) return [asIs];
    return [asIs, v1];
  } catch {
    return [base];
  }
}

const isHtml = (r) => (r.headers.get('content-type') || '').includes('text/html');

// autofill — путь к .env.local: тогда проверка сама исправит там адрес и ключ и допишет модели
export async function checkAI(env, { brief = false, autofill = null } = {}) {
  const { key, base: rawBase } = aiConf(env);
  if (!rawBase || !key) {
    log.skip('ИИ-помощник выключен: впишите в .env.local адрес сервиса AI_BASE_URL и ключ AI_API_KEY.');
    return false;
  }
  let fixable = true; // false — есть ошибка, которую нужно исправить руками
  const fix = (name, value, okText, badText) => {
    if (autofill) {
      setEnvValue(autofill, name, value);
      log.ok(okText);
    } else {
      log.bad(badText);
      fixable = false;
    }
  };
  if (key !== String(env.AI_API_KEY || '').trim()) {
    fix('AI_API_KEY', key, 'Оставил в AI_API_KEY только сам ключ (sk-…).', 'В AI_API_KEY должен быть только сам ключ sk-… — без кавычек, пробелов и лишнего текста.');
  }
  const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };

  // 1) Ищем рабочий адрес API по списку моделей (он есть не у всех сервисов — это не ошибка)
  const bases = apiBases(rawBase);
  let base = '';
  let models = null;
  let netErr = null;
  for (const b of bases) {
    try {
      const r = await fetch(`${b}/models`, { headers, signal: AbortSignal.timeout(20000) });
      if (r.status === 401) {
        log.bad('ИИ: сервис ответил «401» — ключ не подходит. В AI_API_KEY должен быть только сам ключ sk-…, без кавычек и пробелов.');
        return false;
      }
      if (r.ok && !isHtml(r)) {
        const data = await r.json().catch(() => null);
        if (Array.isArray(data?.data)) {
          base = b;
          models = data.data.map((m) => m?.id).filter(Boolean).sort();
          break;
        }
      }
    } catch (e) {
      netErr = e;
    }
  }
  if (!base && netErr) {
    log.bad(`ИИ: не удалось связаться с ${rawBase} — ${reason(netErr)}.`);
    log.info('Проверьте адрес AI_BASE_URL и интернет. Если сайт сервиса открывается только через VPN, VPN нужен и для этой программы.');
    return false;
  }

  let smart = env.AI_MODEL_SMART || env.AI_MODEL || '';
  let fast = env.AI_MODEL_FAST || smart;
  const missing = (m) => !m || (models?.length && !models.includes(m));
  if (models?.length && (!brief || missing(smart) || missing(fast))) {
    log.info(`Модели, доступные по вашему ключу (${models.length}):`);
    log.info(models.slice(0, 60).join(', ') + (models.length > 60 ? ', …' : ''));
  }
  // Название модели с другим регистром букв (deepseek-v4-pro вместо DeepSeek-V4-Pro)
  if (models?.length) {
    for (const name of ['AI_MODEL_SMART', 'AI_MODEL_FAST']) {
      const v = env[name];
      const exact = v && !models.includes(v) && models.find((m) => m.toLowerCase() === v.toLowerCase());
      if (!exact) continue;
      fix(name, exact, `Поправил название модели: ${name}=${exact}`, `Название модели пишется точно как в списке: ${name}=${exact}`);
      if (name === 'AI_MODEL_SMART') {
        if (fast === smart) fast = exact;
        smart = exact;
      } else fast = exact;
    }
  }
  if (!smart) {
    const s = models?.length ? suggest(models) : {};
    if (s.smart) {
      if (autofill) {
        setEnvValue(autofill, 'AI_MODEL_SMART', s.smart);
        setEnvValue(autofill, 'AI_MODEL_FAST', s.fast);
        log.ok(`Выбрал модели и вписал в .env.local: AI_MODEL_SMART=${s.smart}, AI_MODEL_FAST=${s.fast}`);
        log.info('Их можно заменить на другие из списка выше.');
      } else {
        log.skip(`Модели не указаны — сайт выберет сам: ${s.smart} (основная) и ${s.fast} (быстрая).`);
        log.info(`Чтобы закрепить выбор, впишите в .env.local: AI_MODEL_SMART=${s.smart} и AI_MODEL_FAST=${s.fast}`);
      }
      smart = s.smart;
      fast = s.fast;
    } else {
      log.bad('Не указана модель: впишите в .env.local название в AI_MODEL_SMART (и при желании AI_MODEL_FAST).');
      if (s.smart) {
        log.info('Например:');
        log.info(`  AI_MODEL_SMART=${s.smart}`);
        log.info(`  AI_MODEL_FAST=${s.fast}`);
      }
      return false;
    }
  }

  // 2) Пробный запрос к каждой модели
  let allOk = true;
  const tryBases = base ? [base] : bases;
  const list = smart === fast ? [['модель', smart]] : [['основная модель (AI_MODEL_SMART)', smart], ['быстрая модель (AI_MODEL_FAST)', fast]];
  for (const [label, model] of list) {
    if (models?.length && !models.includes(model)) log.bad(`Модели «${model}» нет в списке выше — скопируйте название точно, с учётом букв и дефисов.`);
    const t0 = Date.now();
    // Быструю модель Qwen 3 сайт спрашивает «без размышлений» — проверяем так же
    let noThink = model === fast && /qwen-?3/i.test(model);
    try {
      let r = null;
      for (let i = 0; i < tryBases.length; i++) {
        r = await fetch(`${tryBases[i]}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: 'Ответь одним словом: работает?' }],
            max_tokens: 400,
            temperature: 0,
            stream: false,
            ...(noThink ? { enable_thinking: false, chat_template_kwargs: { enable_thinking: false } } : {}),
          }),
          signal: AbortSignal.timeout(120000),
        });
        if (noThink && r.status === 400) {
          noThink = false;
          i--;
          continue;
        }
        if ((isHtml(r) || r.status === 404 || r.status === 405) && i < tryBases.length - 1) continue;
        if (!base && r.ok && !isHtml(r)) base = tryBases[i];
        break;
      }
      if (isHtml(r)) {
        allOk = false;
        log.bad('ИИ: по адресу AI_BASE_URL открывается сайт, а не API. Нужен адрес API — обычно он заканчивается на /v1 (например, https://api.example.com/v1).');
        break;
      }
      const text = await r.text();
      if (!r.ok) {
        allOk = false;
        log.bad(`ИИ, ${label} «${model}»: ошибка ${r.status} — ${errText(text)}`);
        if (r.status === 400 || r.status === 404) log.info('Чаще всего это неверное название модели или адрес без /v1 в конце.');
        if (r.status === 401 || r.status === 403) log.info('Ключ не подходит к этой модели — проверьте AI_API_KEY и название модели (точно как в списке, с заглавными буквами).');
        if (r.status === 402 || r.status === 429) log.info('Похоже, закончился баланс или лимит запросов — проверьте кабинет сервиса.');
        if (r.status >= 500) log.info('Сервис временно не отвечает — попробуйте позже или другую модель.');
        continue;
      }
      let answer = null;
      try {
        answer = JSON.parse(text)?.choices?.[0]?.message?.content;
      } catch {}
      if (typeof answer !== 'string') {
        allOk = false;
        log.bad(`ИИ, ${label} «${model}»: сервис ответил непонятно — ${errText(text)}`);
        continue;
      }
      answer = stripThink(answer).replace(/\s+/g, ' ').slice(0, 60);
      const sec = (Date.now() - t0) / 1000;
      log.ok(`ИИ: ${label} «${model}» отвечает за ${sec.toFixed(1)} с${answer ? ` — «${answer}»` : ''}.`);
      if (sec > 20)
        log.info('Это медленно (сервис занят). Если модель долго молчит, сайт параллельно спросит вторую — ответит та, что успеет первой.');
    } catch (e) {
      allOk = false;
      log.bad(`ИИ, ${label} «${model}»: ${reason(e)}.`);
    }
  }
  // Рабочий адрес отличается от указанного (не хватало /v1 или вставлена страница сайта)
  if (base && base !== rawBase) {
    fix('AI_BASE_URL', base, `Поправил адрес API в .env.local: AI_BASE_URL=${base}`, `Исправьте адрес в .env.local: AI_BASE_URL=${base}`);
  } else if (base && base !== String(env.AI_BASE_URL || '').trim().replace(/\/+$/, '')) {
    fix('AI_BASE_URL', base, `Привёл адрес API к нужному виду: AI_BASE_URL=${base}`, `Лучше записать адрес так: AI_BASE_URL=${base}`);
  }
  return allOk && fixable;
}

/* ───────── Почта ───────── */

const clean = (v) => String(v || '').trim().replace(/^["']|["']$/g, '').trim();
const MAIL_HOSTS = [
  [/@(yandex\.(ru|com|by|kz|ua)|ya\.ru|narod\.ru)$/i, 'smtp.yandex.ru'],
  [/@(mail\.ru|inbox\.ru|list\.ru|bk\.ru|internet\.ru)$/i, 'smtp.mail.ru'],
  [/@(gmail|googlemail)\.com$/i, 'smtp.gmail.com'],
  [/@(rambler\.ru|lenta\.ru|autorambler\.ru|myrambler\.ru|ro\.ru)$/i, 'smtp.rambler.ru'],
];

/** Настройки почты — так же, как на сайте (src/lib/mail.ts: smtpConf). Меняйте вместе. */
export function smtpConf(env) {
  const user = clean(env.SMTP_USER);
  let pass = clean(env.SMTP_PASS);
  let host = clean(env.SMTP_HOST).replace(/^smtps?:\/\//i, '');
  let port = Number(clean(env.SMTP_PORT)) || 0;
  const hp = host.match(/^([^:/]+):(\d+)/);
  if (hp) [host, port] = [hp[1], port || Number(hp[2])];
  host = host.replace(/[/].*$/, '') || MAIL_HOSTS.find(([re]) => re.test(user))?.[1] || '';
  if (!user || !pass || !host) return null;
  port ||= 465;
  const sec = clean(env.SMTP_SECURE);
  const secure = sec ? !/^(0|false|no|нет)$/i.test(sec) : port === 465;
  if (/gmail/i.test(host)) pass = pass.replace(/\s+/g, '');
  return { host, port, secure, user, pass };
}

/** Понятная причина ошибки почты — те же тексты, что на сайте (src/lib/mail.ts: mailErrorText). */
function mailError(e) {
  const code = String(e?.code || '');
  const resp = String(e?.response || e?.message || e);
  if (code === 'EAUTH' || e?.responseCode === 535 || e?.responseCode === 534)
    return 'неверный логин или пароль почты (SMTP_USER, SMTP_PASS). Для Яндекса, Mail.ru и Gmail нужен «пароль приложения», а не обычный пароль от почты';
  if (code === 'EDNS' || /ENOTFOUND|EAI_AGAIN/.test(resp)) return 'адрес почтового сервера SMTP_HOST не найден — проверьте, нет ли опечатки';
  if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED'].includes(code) || /timeout|ECONNREFUSED|ECONNRESET/i.test(resp))
    return 'нет связи с почтовым сервером — проверьте SMTP_HOST и SMTP_PORT (обычно 465). Иногда порт закрывает антивирус или провайдер';
  if (/certificate|self.signed|CERT/i.test(resp)) return 'ошибка сертификата почтового сервера (так бывает, когда антивирус проверяет защищённые соединения)';
  return resp.slice(0, 200);
}

export async function checkMail(env) {
  const c = smtpConf(env);
  if (!c) {
    if (clean(env.SMTP_USER) || clean(env.SMTP_PASS) || clean(env.SMTP_HOST))
      log.bad('Почта: заполнены не все поля. Нужны SMTP_USER и SMTP_PASS, а для почты не на Яндексе, Mail.ru, Gmail или Rambler — ещё SMTP_HOST.');
    else {
      log.skip('Почта не настроена: коды подтверждения не уходят в письмах, а пишутся в этом окне (и видны на странице при запуске на своём компьютере).');
      log.info('Как включить письма — README, раздел «Почта».');
    }
    return false;
  }
  try {
    const nodemailer = (await import('nodemailer')).default;
    const t = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      auth: { user: c.user, pass: c.pass },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });
    await t.verify();
    t.close();
    log.ok(`Почта: вход в ${c.host} выполнен — коды будут приходить в письмах от ${c.user}.`);
    return true;
  } catch (e) {
    log.bad(`Почта: ${mailError(e)}.`);
    return false;
  }
}

function checkAdmin(env) {
  const list = clean(env.ADMIN_EMAILS).split(/[\s,;]+/).filter(Boolean);
  if (!list.length) {
    log.skip('Админка выключена: впишите свою почту в ADMIN_EMAILS — тогда на странице /admin будут заявки, пользователи и журнал.');
    return false;
  }
  const bad = list.filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if (bad.length) log.bad(`Админка: в ADMIN_EMAILS не похоже на почту: ${bad.join(', ')}`);
  else log.ok(`Админка: http://localhost:3000/admin — для ${list.join(', ')} (войдите на сайт с этой почтой).`);
  return !bad.length;
}

export async function runChecks({ brief = false, autofill = false } = {}) {
  const file = path.join(ROOT, '.env.local');
  const env = readEnv(file);
  if (!env) {
    log.skip('Файла настроек .env.local нет — сайт работает без видео и ИИ.');
    log.info('Создайте его из образца: в Windows — copy .env.example .env.local, в macOS и Linux — cp .env.example .env.local');
    return { video: false, ai: false };
  }
  const video = await checkVideo(env);
  const ai = await checkAI(env, { brief, autofill: autofill ? file : null });
  const mail = await checkMail(env);
  const admin = checkAdmin(env);
  return { video, ai, mail, admin };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log('\nПроверка настроек (.env.local)\n');
  const r = await runChecks();
  console.log('');
  if (r.video && r.ai && r.mail && r.admin) console.log('Всё готово. Если сайт уже запущен, перезапустите его (Ctrl+C, затем npm run dev), чтобы он прочитал новые настройки.');
  else console.log('После правок в .env.local запустите проверку ещё раз: npm run check');
  console.log('');
}
