// Клиент для любого OpenAI-совместимого API (DeepSeek, Qwen, агрегаторы).
//
// Как это устроено:
// • Ответ всегда идёт потоком — так видно, что сервис жив, и не обрываются долгие ответы.
// • «Наперегонки»: если модель долго молчит, параллельно спрашиваем вторую. Отвечает та,
//   что начнёт первой, вторую отменяем. Модель, которая подвела, 15 минут спрашиваем второй.
// • В режиме «Быстро» у Qwen 3 выключаем «размышления»: первые слова через секунды, а не через минуту.
// • Пока ИИ думает, сайт раз в 10 секунд шлёт браузеру невидимый «пульс», чтобы связь не обрывалась.
export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };
export type AiKind = 'smart' | 'fast';

type Conf = { base: string; key: string };

/**
 * Читает настройки и прощает частые ошибки: адрес без /v1, ключ в кавычках или с «Bearer»,
 * строка подключения new-api целиком ({"_type":"newapi_channel_conn","key":"sk-…","url":"https://…"}).
 * Та же логика есть в scripts/check.mjs (aiConf, apiBases) — меняйте вместе.
 */
function conf(): Conf {
  let key = (process.env.AI_API_KEY || '').trim();
  let base = (process.env.AI_BASE_URL || '').trim();
  for (const v of [key, base]) {
    if (!v.startsWith('{')) continue;
    try {
      const j = JSON.parse(v);
      if (typeof j?.key === 'string') key = j.key;
      if (typeof j?.url === 'string' && (!base || base.startsWith('{'))) base = j.url;
    } catch {
      /* не JSON — оставляем как есть */
    }
  }
  key = key.replace(/^bearer\s+/i, '').replace(/^["'\s]+|["'\s]+$/g, '');
  if (/\s/.test(key)) key = key.match(/sk-[\w-]{16,}/)?.[0] ?? key.replace(/\s+/g, '');
  base = base.replace(/^["'\s]+|["'\s]+$/g, '').replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  return { base, key };
}

/** Варианты адреса API по порядку: «сайт + /v1» для адреса без пути, иначе как указано (и запасной /v1). */
function apiBases(base: string) {
  try {
    const u = new URL(base);
    const path = u.pathname.replace(/\/+$/, '');
    const asIs = u.origin + path;
    const v1 = `${u.origin}/v1`;
    if (!path) return [v1, asIs];
    if (/\/v\d+$/.test(path)) return [asIs];
    return [asIs, v1];
  } catch {
    return [base];
  }
}

export const aiConfigured = () => {
  const c = conf();
  return Boolean(c.base && c.key);
};

// Список моделей сервиса: чтобы выбрать модель, если она не указана, и поправить регистр букв в названии
let modelCache: { sig: string; at: number; list: string[] } | null = null;

async function listModels(c: Conf) {
  const sig = `${c.base}|${c.key.slice(-8)}`;
  if (modelCache?.sig === sig && Date.now() - modelCache.at < 600_000) return modelCache.list;
  let list: string[] = [];
  for (const b of apiBases(c.base)) {
    try {
      const r = await fetch(`${b}/models`, { headers: { authorization: `Bearer ${c.key}` }, signal: AbortSignal.timeout(8000) });
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) continue;
      const data = ((await r.json()) as { data?: { id?: unknown }[] })?.data;
      if (Array.isArray(data)) {
        list = data.map((m) => m?.id).filter((id): id is string => typeof id === 'string');
        break;
      }
    } catch {
      /* у некоторых сервисов нет списка моделей — это не ошибка */
    }
  }
  modelCache = { sig, at: Date.now(), list };
  return list;
}

const pick = (list: string[], res: RegExp[]) => {
  for (const re of res) {
    const m = list.find((id) => re.test(id));
    if (m) return m;
  }
  return '';
};
// Та же логика выбора есть в scripts/check.mjs (suggest) — меняйте вместе.
const SMART_RE = [/deepseek.*v4.*pro/i, /deepseek.*v4/i, /deepseek.*(v3|chat)/i, /qwen.*(max|plus|235b|397b)/i, /deepseek/i, /qwen/i, /gpt-?[45]/i];
// Для быстрых ответов «думающие» модели (r1, qwq, thinking) не подходят — они молчат по минуте
const THINKING_RE = /(^|[^a-z0-9])(r1|qwq)([^a-z0-9]|$)|think|reason/i;
const FAST_RE = [/flash|turbo|instant|lite|mini|haiku|nano/i, /deepseek.*chat/i, /qwen.*\D(7|8|14|27|30|32)b/i, /qwen/i];

/** Основная и быстрая модели. Быструю не указали — используем основную. */
async function models(c: Conf) {
  const env = (k: string) => (process.env[k] || '').trim();
  const list = await listModels(c);
  const fix = (want: string) => (list.includes(want) ? want : (list.find((id) => id.toLowerCase() === want.toLowerCase()) ?? want));
  const smartEnv = env('AI_MODEL_SMART') || env('AI_MODEL');
  const fastEnv = env('AI_MODEL_FAST');
  const smart = smartEnv ? fix(smartEnv) : list.length ? pick(list, SMART_RE) || list[0] : fastEnv || 'deepseek-chat';
  const fast = fastEnv
    ? fix(fastEnv)
    : smartEnv || !list.length
      ? smart
      : pick(list.filter((id) => id !== smart && !THINKING_RE.test(id)), FAST_RE) || smart;
  return { smart, fast };
}

/* ───────── Один запрос к одной модели ───────── */

// Qwen 3 сначала «размышляет» (30–60 секунд). Для быстрых ответов это выключаем.
const HYBRID_RE = /qwen-?3/i;
const NO_THINK = { enable_thinking: false, chat_template_kwargs: { enable_thinking: false } };
const noThinkRejected = new Set<string>(); // модели, которые не приняли этот параметр

// Ждём не по общему времени, а по тишине: сервисы-посредники бывают медленными
const IDLE_BEFORE_MS = 120_000; // до первых слов (очередь у сервиса, «размышления» модели)
const IDLE_AFTER_MS = 45_000; // ответ уже идёт и вдруг замолчал — значит, оборвался
const MAX_MS = 600_000;

type Attempt = {
  c: Conf;
  model: string;
  messages: ChatMsg[];
  kind: AiKind;
  maxTokens: number;
  signal: AbortSignal;
  onText: (text: string) => void;
};

async function post(o: Attempt, signal: AbortSignal) {
  const bases = apiBases(o.c.base);
  let noThink = o.kind === 'fast' && HYBRID_RE.test(o.model) && !noThinkRejected.has(o.model);
  for (let i = 0; i < bases.length; i++) {
    const res = await fetch(`${bases[i]}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${o.c.key}` },
      body: JSON.stringify({
        model: o.model,
        messages: o.messages,
        stream: true,
        temperature: 0.4,
        max_tokens: o.maxTokens,
        ...(noThink ? NO_THINK : {}),
      }),
      signal,
    });
    // Вместо API открылась веб-страница сервиса (или 404) — пробуем следующий вариант адреса
    const html = (res.headers.get('content-type') || '').includes('text/html');
    if ((html || res.status === 404 || res.status === 405) && i < bases.length - 1) {
      await res.body?.cancel().catch(() => {});
      continue;
    }
    if (html) {
      await res.body?.cancel().catch(() => {});
      throw new Error('AI html');
    }
    if (res.ok) return res;
    const text = await res.text().catch(() => '');
    if (noThink && res.status === 400) {
      // Сервис не понял параметр «без размышлений» — повторяем как обычно и больше его не шлём
      noThinkRejected.add(o.model);
      noThink = false;
      i--;
      continue;
    }
    throw new Error(`AI ${res.status}: ${text.slice(0, 300)}`);
  }
  throw new Error('AI: нет адреса');
}

/** Сколько символов в конце строки могут оказаться началом тега (тег разрезан между кусками). */
function partialTag(s: string, tag: string) {
  for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) if (s.endsWith(tag.slice(0, k))) return k;
  return 0;
}

/** Убирает «размышления» в <think>…</think>, даже если теги пришли по частям, и пробелы в начале ответа. */
function thinkFilter() {
  let pend = '';
  let inThink = false;
  let started = false;
  return (chunk: string, end = false) => {
    pend += chunk;
    let out = '';
    for (;;) {
      if (inThink) {
        const i = pend.indexOf('</think>');
        if (i < 0) {
          pend = end ? '' : pend.slice(-7);
          break;
        }
        pend = pend.slice(i + 8);
        inThink = false;
      } else {
        const i = pend.indexOf('<think>');
        if (i < 0) {
          const keep = end ? 0 : partialTag(pend, '<think>');
          out += pend.slice(0, pend.length - keep);
          pend = pend.slice(pend.length - keep);
          break;
        }
        out += pend.slice(0, i);
        pend = pend.slice(i + 7);
        inThink = true;
      }
    }
    if (!started) {
      out = out.replace(/^\s+/, '');
      if (out) started = true;
    }
    return out;
  };
}

/** Спрашивает одну модель. Текст ответа отдаёт в onText по кусочкам; complete — ответ пришёл целиком. */
async function attempt(o: Attempt): Promise<{ complete: boolean }> {
  const ctrl = new AbortController();
  const stop = (why: string) => !ctrl.signal.aborted && ctrl.abort(new Error(why));
  const onOuter = () => stop(String((o.signal.reason as Error)?.message || 'AI aborted'));
  if (o.signal.aborted) onOuter();
  else o.signal.addEventListener('abort', onOuter, { once: true });
  let got = 0;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(idle);
    idle = setTimeout(() => stop(got ? 'AI stall' : 'AI timeout'), got ? IDLE_AFTER_MS : IDLE_BEFORE_MS);
  };
  const hard = setTimeout(() => stop('AI timeout'), MAX_MS);
  const think = thinkFilter();
  const emit = (t: string, end = false) => {
    const out = think(t, end);
    if (!out) return;
    got += out.length;
    o.onText(out);
  };
  arm();
  try {
    const res = await post(o, ctrl.signal);
    arm();
    let body = res.body;
    // Редкие сервисы игнорируют stream и присылают обычный JSON
    if (!(res.headers.get('content-type') || '').includes('text/event-stream')) {
      const raw = await res.text();
      if (!raw.includes('data:')) {
        let j: { choices?: { message?: { content?: unknown } }[]; error?: { message?: string } } | null = null;
        try {
          j = JSON.parse(raw);
        } catch {
          throw new Error(`AI: непонятный ответ сервиса: ${raw.slice(0, 120)}`);
        }
        if (j?.error) throw new Error(`AI stream: ${String(j.error.message || JSON.stringify(j.error)).slice(0, 300)}`);
        emit(String(j?.choices?.[0]?.message?.content ?? ''), true);
        return { complete: true };
      }
      body = new Response(raw).body; // это всё-таки поток, просто без нужного заголовка
    }
    if (!body) throw new Error('AI: пустой ответ');
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;
    const line = (l: string) => {
      const t = l.trim();
      if (!t.startsWith('data:')) return;
      const payload = t.slice(5).trim();
      if (payload === '[DONE]') {
        finished = true;
        return;
      }
      let j: {
        error?: { message?: string };
        choices?: { delta?: { content?: unknown }; message?: { content?: unknown }; finish_reason?: unknown }[];
      } | null = null;
      try {
        j = JSON.parse(payload);
      } catch {
        return; // неполная строка — пропускаем
      }
      if (j?.error) throw new Error(`AI stream: ${String(j.error.message || JSON.stringify(j.error)).slice(0, 300)}`);
      const ch = j?.choices?.[0];
      if (!ch) return;
      // «Размышления» (reasoning_content) не показываем, но они продлевают ожидание — модель жива
      const text = ch.delta?.content ?? ch.message?.content;
      if (typeof text === 'string' && text) emit(text);
      if (ch.finish_reason) finished = true;
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      arm();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const l of lines) line(l);
    }
    line(buffer + decoder.decode());
    emit('', true);
    return { complete: finished };
  } catch (e) {
    throw ctrl.signal.aborted ? ctrl.signal.reason : e;
  } finally {
    clearTimeout(idle);
    clearTimeout(hard);
    o.signal.removeEventListener('abort', onOuter);
    stop('AI done'); // освобождаем соединение, если вышли раньше конца
  }
}

/* ───────── Две модели наперегонки ───────── */

// Через сколько секунд тишины спрашивать вторую модель
const HEDGE_MS: Record<AiKind, number> = { fast: 6_000, smart: 20_000 };
const BAD_MS = 15 * 60e3;
const bad = new Map<string, number>(); // модель → до какого времени спрашиваем её второй
const isBad = (m: string) => (bad.get(m) ?? 0) > Date.now();
function markBad(model: string, why: string) {
  if (!isBad(model)) console.warn(`[ИИ] «${model}» ${why}. Следующие 15 минут сначала спрашиваю другую модель.`);
  bad.set(model, Date.now() + BAD_MS);
}
const ours = (e: unknown) => /^AI (lost|aborted|done)$/.test(String((e as Error)?.message));

type RaceResult = { model: string; complete: boolean; error?: unknown };

async function race(messages: ChatMsg[], kind: AiKind, maxTokens: number, signal: AbortSignal | undefined, onText: (t: string) => void) {
  const c = conf();
  const m = await models(c);
  let order = [...new Set(kind === 'fast' ? [m.fast, m.smart] : [m.smart, m.fast])];
  if (order.length > 1 && isBad(order[0]) && !isBad(order[1])) order = [order[1], order[0]];

  return new Promise<RaceResult>((resolve, reject) => {
    type Run = { model: string; ctrl: AbortController; err?: unknown };
    const runs: Run[] = [];
    let winner: Run | null = null;
    let settled = false;
    let hedge: ReturnType<typeof setTimeout> | undefined;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(hedge);
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const abortAll = (keep: Run | null, why: string) => {
      for (const r of runs) if (r !== keep && !r.ctrl.signal.aborted) r.ctrl.abort(new Error(why));
    };

    const start = (model: string) => {
      const run: Run = { model, ctrl: new AbortController() };
      runs.push(run);
      attempt({
        c,
        model,
        messages,
        kind,
        maxTokens,
        signal: run.ctrl.signal,
        onText: (t) => {
          if (!winner && !settled) {
            winner = run; // первая начавшая отвечать — победила, остальные отменяем
            clearTimeout(hedge);
            abortAll(run, 'AI lost');
            if (run !== runs[0]) markBad(runs[0].model, `молчала дольше, чем «${model}»`);
          }
          if (run === winner) onText(t);
        },
      }).then(
        (r) => {
          if (run === winner) {
            if (!r.complete) markBad(model, 'оборвала ответ на полуслове');
            return settle(() => resolve({ model, complete: r.complete }));
          }
          if (winner || settled) return;
          run.err = new Error('AI: пустой ответ');
          next(run);
        },
        (e) => {
          if (run === winner) {
            if (!ours(e)) markBad(model, `оборвала ответ (${aiErrorText(e)})`);
            return settle(() => resolve({ model, complete: false, error: e }));
          }
          if (winner || settled) return;
          run.err = e;
          next(run);
        },
      );
    };

    // Попытка не удалась ещё до начала ответа: зовём запасную модель или сдаёмся
    const next = (failed: Run) => {
      // Неверный ключ или адрес — беда не конкретной модели, помечать её незачем
      if (order.length > 1 && !/^AI (401|402|html)/.test(String((failed.err as Error)?.message)))
        markBad(failed.model, `не ответила: ${aiErrorText(failed.err)}`);
      if (runs.length < order.length) {
        clearTimeout(hedge);
        start(order[runs.length]);
        return;
      }
      if (runs.every((r) => r.err)) {
        const errs = runs.map((r) => r.err);
        // Показываем самую понятную причину: «нет денег» или «неверный ключ» полезнее, чем «долго молчал»
        settle(() => reject(errs.find((e) => !/^AI (timeout|stall)/.test(String((e as Error)?.message))) ?? errs[0]));
      }
    };

    const onAbort = () =>
      settle(() => {
        abortAll(null, 'AI aborted');
        reject(new Error('AI aborted'));
      });
    if (signal?.aborted) return reject(new Error('AI aborted'));
    signal?.addEventListener('abort', onAbort, { once: true });

    start(order[0]);
    if (order.length > 1)
      hedge = setTimeout(() => {
        if (!winner && !settled && runs.length === 1) start(order[1]);
      }, HEDGE_MS[kind]);
  });
}

/* ───────── Ошибки ───────── */

/** Понятное объяснение ошибки ИИ — для окна сайта и для журнала в чёрном окне. */
export function aiErrorText(e: unknown) {
  const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string } } | null;
  const msg = String(err?.message ?? e);
  const code = String(err?.cause?.code || '');
  const status = Number(msg.match(/^AI (\d{3})/)?.[1] || 0);
  const model = msg.match(/model\W{0,3}([\w.:/-]+)/i)?.[1];
  const aboutModel = /no access to model|model.{0,40}(not exist|not found|not supported|unavailable)|unknown model|invalid model|无可用渠道/i.test(msg);
  if (msg === 'AI html') return 'по адресу AI_BASE_URL открывается сайт, а не API. Нужен адрес API — обычно он заканчивается на /v1';
  if (status === 401 || /invalid token|incorrect api key|invalid api key|unauthori[sz]ed/i.test(msg))
    return 'ключ не подходит — проверьте AI_API_KEY: там должен быть только сам ключ sk-…, без кавычек и пробелов';
  if (aboutModel)
    return `сервис не даёт модель${model ? ` «${model}»` : ''} — проверьте AI_MODEL_SMART и AI_MODEL_FAST: название пишется точно как в списке моделей сервиса`;
  if (status === 402 || status === 429 || /quota|insufficient|balance|余额|额度|rate.?limit/i.test(msg))
    return 'закончился баланс или лимит запросов у сервиса ИИ — проверьте кабинет сервиса';
  if (status === 404) return 'сервис ответил «не найдено» (404) — проверьте AI_BASE_URL (обычно заканчивается на /v1) и названия моделей';
  if (status === 403) return 'сервис ИИ отказал в доступе (403) — проверьте ключ и доступ к модели в кабинете сервиса';
  if (status >= 500) return 'сервис ИИ сейчас не работает — попробуйте через пару минут';
  if (status) return `сервис ИИ ответил ошибкой ${status}: ${msg.replace(/^AI \d{3}:\s*/, '').slice(0, 160)}`;
  if (msg === 'AI stall') return 'сервис ИИ начал отвечать и замолчал — попробуйте ещё раз';
  if (msg === 'AI aborted' || msg === 'AI lost') return 'запрос отменён';
  if (/AI timeout/.test(msg) || err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'сервис ИИ слишком долго не отвечал — попробуйте ещё раз';
  if (msg.startsWith('AI stream: ')) return `сервис ИИ сообщил об ошибке: ${msg.slice(11, 180)}`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'адрес сервиса ИИ не найден — проверьте AI_BASE_URL и интернет';
  if (/CERT|SSL|TLS/i.test(code) || /certificate/i.test(String(err?.cause?.message)))
    return 'ошибка сертификата https — так бывает, когда антивирус проверяет защищённые соединения';
  if (code || /fetch failed|ECONNRESET|socket/i.test(msg))
    return 'нет связи с сервисом ИИ — проверьте интернет. Если сайт сервиса открывается только через VPN, VPN нужен и для этой программы';
  if (/пустой ответ/.test(msg)) return 'сервис прислал пустой ответ — попробуйте ещё раз';
  return msg.replace(/^AI:?\s*/, '').slice(0, 200);
}

/** Текст ошибки для пользователя (и запись в журнал). Подробности — репетитору и при запуске на своём компьютере. */
export function aiErrorMessage(e: unknown, showDetails = false) {
  const why = aiErrorText(e);
  console.error(`[ИИ] ${why}\n     (${String((e as Error)?.message ?? e).slice(0, 300)})`);
  return showDetails || process.env.NODE_ENV !== 'production' ? `ИИ не ответил: ${why}` : 'ИИ-помощник сейчас недоступен, попробуйте позже';
}

/** Ответ сайта при ошибке ИИ (обычный JSON). */
export function aiFail(e: unknown, showDetails: boolean) {
  return Response.json({ error: aiErrorMessage(e, showDetails) }, { status: 502 });
}

/** Убирает «размышления» моделей (Qwen, DeepSeek R1 пишут их в <think>…</think>). */
export const stripThink = (s: string) => s.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();

/* ───────── Ответы сайта ───────── */

/** Метка ошибки внутри потока: всё после неё — текст ошибки, а не ответ. */
export const AI_ERR = '\u001eERR:';
/** Невидимый «пульс» (браузер его выбрасывает): держит связь, пока ИИ думает. */
const BEAT = '\u200b';
const BEAT_MS = 10_000;
export const STREAM_HEADERS = {
  'content-type': 'text/plain; charset=utf-8',
  'cache-control': 'no-store, no-transform', // no-transform: прокси не сжимают и не копят поток
  'x-accel-buffering': 'no',
};

/** Поток для чата: браузер получает ответ сразу, текст — по мере прихода. */
export function aiStream(
  messages: ChatMsg[],
  kind: AiKind,
  opts: { maxTokens?: number; details?: boolean; signal?: AbortSignal; /** ответ пришёл целиком */ onDone?: () => void } = {},
) {
  const enc = new TextEncoder();
  const ctrl = new AbortController();
  const onReq = () => ctrl.abort();
  let beat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let last = 0;
  const finish = () => {
    closed = true;
    clearInterval(beat);
    opts.signal?.removeEventListener('abort', onReq);
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(s));
          last = Date.now();
        } catch {
          closed = true;
        }
      };
      opts.signal?.addEventListener('abort', onReq, { once: true });
      write(BEAT);
      beat = setInterval(() => Date.now() - last >= BEAT_MS - 1000 && write(BEAT), BEAT_MS);
      race(messages, kind, opts.maxTokens ?? 4000, ctrl.signal, write)
        .then((r) => {
          if (r.complete) return opts.onDone?.();
          console.warn(`[ИИ] ответ «${r.model}» оборвался${r.error ? `: ${aiErrorText(r.error)}` : ''}`);
          write(`${AI_ERR}Ответ оборвался — сервис ИИ перестал присылать текст. Нажмите «Повторить».`);
        })
        .catch((e) => {
          if (!ctrl.signal.aborted) write(AI_ERR + aiErrorMessage(e, opts.details));
        })
        .finally(() => {
          const wasClosed = closed;
          finish();
          if (!wasClosed)
            try {
              controller.close();
            } catch {
              /* браузер уже ушёл */
            }
        });
    },
    cancel() {
      finish();
      ctrl.abort(); // пользователь закрыл страницу или нажал «Стоп» — отменяем запрос к ИИ
    },
  });
}

const retryable = (e: unknown) => {
  const m = String((e as Error)?.message);
  return !/^AI (40[1-4]|html|aborted)/.test(m) && !/quota|balance|insufficient|余额|额度/i.test(m);
};

/** Полный ответ строкой (для задач и конспектов). Ответ оборвался или сервис сбоил — спрашивает ещё раз. */
export async function aiComplete(messages: ChatMsg[], kind: AiKind = 'smart', opts: { maxTokens?: number; signal?: AbortSignal } = {}) {
  let lastErr: unknown = new Error('AI: пустой ответ');
  for (let i = 0; i < 2 && !opts.signal?.aborted; i++) {
    let text = '';
    try {
      const r = await race(messages, kind, opts.maxTokens ?? 4000, opts.signal, (t) => (text += t));
      text = stripThink(text);
      if (r.complete && text) return text;
      lastErr = r.error ?? new Error(text ? 'AI stall' : 'AI: пустой ответ');
      console.warn(`[ИИ] ответ «${r.model}» оборвался — спрашиваю ещё раз`);
    } catch (e) {
      lastErr = e;
      if (!retryable(e)) break;
    }
  }
  throw lastErr;
}

/**
 * JSON-ответ для долгой работы ИИ (задачи, конспект). Пока ИИ думает, раз в 10 секунд шлём пробел:
 * иначе Cloudflare и другие прокси обрывают запрос, который молчит дольше 100 секунд.
 * Поэтому код ответа всегда 200, а ошибка приходит в поле error.
 */
export function aiJson(req: Request, details: boolean, work: (signal: AbortSignal) => Promise<Record<string, unknown>>) {
  const enc = new TextEncoder();
  const ctrl = new AbortController();
  const onReq = () => ctrl.abort();
  let beat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          closed = true;
        }
      };
      req.signal?.addEventListener('abort', onReq, { once: true });
      write(' ');
      beat = setInterval(() => write(' '), BEAT_MS);
      work(ctrl.signal)
        .then(
          (data) => write(JSON.stringify(data)),
          (e) => {
            if (!ctrl.signal.aborted) write(JSON.stringify({ error: aiErrorMessage(e, details) }));
          },
        )
        .finally(() => {
          clearInterval(beat);
          req.signal?.removeEventListener('abort', onReq);
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              /* браузер уже ушёл */
            }
          }
        });
    },
    cancel() {
      closed = true;
      clearInterval(beat);
      ctrl.abort();
    },
  });
  return new Response(stream, { headers: { ...STREAM_HEADERS, 'content-type': 'application/json; charset=utf-8' } });
}

export const TUTOR_STYLE = `Ты — доброжелательный и терпеливый репетитор. Помогаешь ученикам любого возраста: школьникам, студентам и взрослым.
Пиши по-русски, простыми словами, короткими абзацами. Формулы оформляй в LaTeX: $...$ внутри строки и $$...$$ отдельной строкой.`;
