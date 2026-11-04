'use client';

import { LiveKitRoom, RoomAudioRenderer, StartAudio } from '@livekit/components-react';
import {
  ConnectionError,
  ConnectionErrorReason,
  ConnectionState,
  DisconnectReason,
  MediaDeviceFailure,
  Room,
  type RoomOptions,
  VideoPresets,
} from 'livekit-client';
import { Check, Info, Link2, LoaderCircle, Lock, Mic, MicOff, PenLine, Timer, UserX, Video, VideoOff } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Logo } from '@/components/Logo';
import { PhoneVerify } from '@/components/app/PhoneVerify';
import { WaitHint, useHydrated } from '@/components/useHydrated';
import type { VideoState } from '@/lib/billing';
import { PLANS, TRIAL_MIN, rub } from '@/lib/plans';
import { shareOrigin, usePublicOrigin } from '@/lib/publicOrigin';
import { CAM_KEY, MIC_KEY, type Devices, isMediaError, mediaErrorText, missingText, probeDevices, savedDevice } from './devices';
import { RoomUI } from './RoomUI';

export type LessonInfo = { code: string; title: string; subject: string | null; tutor: string };
type Conn = { token: string; url: string; identity: string; name: string; isHost: boolean; trialEndsAt: number | null };
/** Для учеников и гостей: видео есть, ждём репетитора (wait) или видео в уроке нет (off) */
export type GuestAccess = { ok: boolean; reason: 'wait' | 'off' | null };

// Качество связи: камера 720p (30 кадров), звук 48 кбит/с с защитой от потерь, экран — 1080p.
// Собеседнику приходит столько, сколько нужно для размера окна на его экране (с учётом чёткости экрана)
const ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: { pixelDensity: 'screen' },
  dynacast: true,
  publishDefaults: {
    simulcast: true,
    videoEncoding: { maxBitrate: 2_000_000, maxFramerate: 30 },
    videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
    audioPreset: { maxBitrate: 48_000 },
    dtx: true,
    red: true,
  },
  videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
  audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, voiceIsolation: true },
};

/** Камера и микрофон — те, что выбраны в «Настройках» или в прошлом уроке (если их отключили — возьмём любые). */
function roomOptions(): RoomOptions {
  const cam = savedDevice(CAM_KEY);
  const mic = savedDevice(MIC_KEY);
  return {
    ...ROOM_OPTIONS,
    videoCaptureDefaults: { ...ROOM_OPTIONS.videoCaptureDefaults, ...(cam && { deviceId: { ideal: cam } }) },
    audioCaptureDefaults: { ...ROOM_OPTIONS.audioCaptureDefaults, ...(mic && { deviceId: { ideal: mic } }) },
  };
}

const PRICES = `«${PLANS.start.name}» — ${rub(PLANS.start.price.month)} в месяц, «${PLANS.pro.name}» — ${rub(PLANS.pro.price.month)} в месяц`;

/** Понятное объяснение, почему не удалось подключиться к видеосвязи. */
function connectErrorText(e: unknown, isHost: boolean) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false)
    return 'Нет подключения к интернету. Проверьте Wi-Fi или мобильный интернет и попробуйте ещё раз.';
  const msg = (e as Error | null)?.message || '';
  if (e instanceof ConnectionError && e.reason === ConnectionErrorReason.NotAllowed)
    return 'Видеосервер не пустил в урок. Обновите страницу и попробуйте снова.';
  if (/pc connection|peer ?connection|ice/i.test(msg))
    return isHost
      ? 'Видео не проходит через сеть. Выключите VPN и попробуйте ещё раз. Если сайт запущен на вашем компьютере и видео не подключается ни у кого — включите UPnP в настройках роутера (подробно — в README, раздел «Видео без VPN»). Доска и чат работают и так.'
      : 'Видео не проходит через вашу сеть. Так бывает с включённым VPN или в рабочей и школьной сети. Выключите VPN или подключитесь к другой сети (например, раздайте интернет с телефона) и попробуйте ещё раз. Доска и чат работают и так.';
  return isHost
    ? 'Видеосервер не отвечает. Если сайт запущен на вашем компьютере, посмотрите окно запуска (npm run share): там написано, что не так. Попробуйте ещё раз или откройте доску и чат без видео.'
    : 'Видеосервер не отвечает. Проверьте интернет и попробуйте ещё раз через минуту — или откройте доску и чат без видео.';
}

function CopyInvite({ code }: { code: string }) {
  const [done, setDone] = useState(false);
  usePublicOrigin();
  return (
    <button
      type="button"
      className="btn btn-soft h-auto min-h-12 py-3 text-center leading-tight whitespace-normal"
      onClick={async () => {
        const url = `${shareOrigin()}/lesson/${code}`;
        try {
          await navigator.clipboard.writeText(url);
          setDone(true);
          setTimeout(() => setDone(false), 2500);
        } catch {
          window.prompt('Скопируйте ссылку на урок', url);
        }
      }}
    >
      {done ? <Check size={18} /> : <Link2 size={18} />}
      {done ? 'Ссылка скопирована' : 'Скопировать ссылку для ученика'}
    </button>
  );
}

function PreJoin({
  lesson,
  user,
  onJoin,
  onBoard,
  busy,
  error,
  boardOnly,
  fallback,
  locked,
  access,
  onAccess,
  waiting,
}: {
  lesson: LessonInfo;
  user: { name: string; isOwner: boolean } | null;
  onJoin: (name: string, mic: boolean, cam: boolean, trial?: boolean) => void;
  /** Открыть доску и чат без видео */
  onBoard: (name: string) => void;
  busy: boolean;
  error: string;
  /** Репетитор закрыл вход в урок (показываем только ему) */
  locked?: boolean;
  /** Видеосервер не настроен — можно зайти только на доску и в чат */
  boardOnly?: boolean;
  /** Видео не подключилось — рядом с кнопкой входа показываем «доску и чат без видео» */
  fallback?: boolean;
  /** Только репетитору: есть ли видео в уроке по его тарифу */
  access?: VideoState | null;
  onAccess?: (s: VideoState) => void;
  /** Ученик ждёт, когда репетитор начнёт урок (подключим сами) */
  waiting?: boolean;
}) {
  const gate = user?.isOwner && access && !access.ok ? access.reason : null;
  // Видео сейчас не включить: сначала телефон или тариф — главная кнопка открывает доску и чат
  const noVideo = gate === 'phone' || gate === 'trial-over' || gate === 'plan';
  const trialEnds = user?.isOwner && access?.ok && access.via === 'trial' ? access.endsAt : null;
  const [name, setName] = useState(user?.name ?? '');
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(!boardOnly && gate !== 'trial-over' && gate !== 'plan');
  const [devError, setDevError] = useState('');
  const [devices, setDevices] = useState<Devices | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ready = useHydrated();

  useEffect(() => {
    if (!user) setName((n) => n || localStorage.getItem('parta-name') || '');
  }, [user]);

  // Нет камеры или микрофона (или страница открыта не по https) — сразу выключаем их и объясняем
  useEffect(() => {
    probeDevices().then((d) => {
      setDevices(d);
      if (!d.mic) setMic(false);
      if (!d.cam) setCam(false);
    });
  }, []);
  const noMic = devices ? !devices.mic : false;
  const noCam = devices ? !devices.cam : false;
  const devNote = !devices
    ? ''
    : !devices.secure
      ? mediaErrorText(null)
      : noMic && noCam
        ? 'Камера и микрофон не найдены. Можно войти без них: вы будете видеть и слышать собеседника, писать в чат и рисовать на доске.'
        : noCam
          ? 'Камера не найдена — вы войдёте без видео. Вас будет слышно.'
          : noMic
            ? 'Микрофон не найден — вас не будет слышно, но можно писать в чат. Подключите микрофон и включите его в уроке.'
            : '';

  useEffect(() => {
    if (!cam || !navigator.mediaDevices?.getUserMedia) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    const saved = savedDevice(CAM_KEY);
    navigator.mediaDevices
      .getUserMedia({ video: { width: 640, height: 480, ...(saved && { deviceId: { ideal: saved } }) }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        setDevError('');
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch((e) => setDevError(mediaErrorText(e, 'cam')));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [cam]);

  // Телефон подтверждён — узнаём, можно ли теперь начать пробный урок
  async function refresh() {
    const s = await fetch(`/api/lessons/${lesson.code}/access`)
      .then((r) => (r.ok ? (r.json() as Promise<VideoState>) : null))
      .catch(() => null);
    onAccess?.(s ?? { ok: false, reason: 'trial' });
  }

  const board = () => {
    if (!user) localStorage.setItem('parta-name', name.trim());
    onBoard(name.trim());
  };

  return (
    <div className="min-h-dvh bg-mist">
      <header className="wrap flex h-16 items-center">
        <Link href="/" aria-label="На главную">
          <Logo />
        </Link>
      </header>
      <main className="wrap grid min-h-[calc(100dvh-4rem)] grid-cols-1 content-center items-center gap-8 pt-2 pb-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-12 lg:pb-16">
        <div className="relative aspect-video overflow-hidden rounded-[24px] bg-brand-950">
          {cam && !devError ? (
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
          ) : (
            <div className="grid h-full place-items-center text-center text-white/80">
              <div>
                <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-white/15 text-3xl font-medium text-white">
                  {(name || '?').slice(0, 1).toUpperCase()}
                </span>
                <p className="mx-auto mt-3 max-w-[460px] px-6 text-[15px]">{devError || (noCam ? 'Камера не найдена' : 'Камера выключена')}</p>
              </div>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-4 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => setMic((v) => !v)}
              disabled={noMic}
              title={noMic ? 'Микрофон не найден' : undefined}
              className={`grid h-12 w-12 place-items-center rounded-full disabled:opacity-60 ${mic ? 'bg-white/90 text-ink' : 'bg-danger text-white'}`}
              aria-label={noMic ? 'Микрофон не найден' : mic ? 'Выключить микрофон' : 'Включить микрофон'}
            >
              {mic ? <Mic size={20} /> : <MicOff size={20} />}
            </button>
            <button
              type="button"
              onClick={() => setCam((v) => !v)}
              disabled={noCam}
              title={noCam ? 'Камера не найдена' : undefined}
              className={`grid h-12 w-12 place-items-center rounded-full disabled:opacity-60 ${cam ? 'bg-white/90 text-ink' : 'bg-danger text-white'}`}
              aria-label={noCam ? 'Камера не найдена' : cam ? 'Выключить камеру' : 'Включить камеру'}
            >
              {cam ? <Video size={20} /> : <VideoOff size={20} />}
            </button>
          </div>
        </div>
        <div>
          {lesson.subject && <p className="tag text-brand-700">{lesson.subject}</p>}
          <h1 className="mt-3 text-[32px] leading-tight font-medium sm:text-[40px]">{lesson.title}</h1>
          <p className="mt-2 text-ink-2">Репетитор: {lesson.tutor}</p>
          {gate === 'phone' && (
            <section className="mt-6 rounded-2xl bg-white p-5 shadow-soft sm:p-6">
              <h2 className="text-[18px] font-medium">Пробный урок с видео — бесплатно</h2>
              <p className="mt-1.5 mb-4 text-[15px] text-ink-2">
                {TRIAL_MIN} минут видеосвязи с учениками. Чтобы начать, подтвердите номер телефона — один раз. Мы позвоним, отвечать не нужно.
              </p>
              <PhoneVerify compact onDone={refresh} />
            </section>
          )}
          <form
            className={`${gate === 'phone' ? 'mt-4' : 'mt-8'} grid grid-cols-1 gap-4`}
            method="post"
            onSubmit={(e) => {
              e.preventDefault();
              if (boardOnly || noVideo) return board();
              if (!user) localStorage.setItem('parta-name', name.trim());
              onJoin(name.trim(), mic && !noMic, cam && !noCam && !devError, gate === 'trial');
            }}
          >
            {locked && user?.isOwner && (
              <p className="flex gap-2.5 rounded-xl bg-tint px-4 py-3 text-[15px] text-ink">
                <Lock size={18} className="mt-0.5 shrink-0 text-brand-700" />
                Вход в урок закрыт: зайти могут только те, кто уже был на нём. Открыть вход можно в уроке, во вкладке «Участники».
              </p>
            )}
            {gate === 'trial' && (
              <p className="flex gap-2.5 rounded-xl bg-tint px-4 py-3 text-[15px] text-ink">
                <Timer size={18} className="mt-0.5 shrink-0 text-brand-700" />
                <span>
                  Первый урок с видео — бесплатно: {TRIAL_MIN} минут. Потом видео выключится, а доска и чат останутся. Пробный урок — один на аккаунт.
                </span>
              </p>
            )}
            {trialEnds !== null && (
              <p className="flex gap-2.5 rounded-xl bg-tint px-4 py-3 text-[15px] text-ink">
                <Timer size={18} className="mt-0.5 shrink-0 text-brand-700" />
                <span>
                  Идёт пробный урок{ready ? ` — осталось ${Math.max(1, Math.ceil((trialEnds - Date.now()) / 60000))} мин.` : '.'} Потом видео выключится, а доска и чат
                  останутся.
                </span>
              </p>
            )}
            {(gate === 'trial-over' || gate === 'plan') && (
              <div className="rounded-xl bg-[#fff4cc] px-4 py-3 text-[15px] text-ink">
                <p className="font-medium">{gate === 'trial-over' ? 'Пробный урок закончился' : 'Пробный урок уже использован'}</p>
                <p className="mt-1">Уроки с видео — по подписке: {PRICES}. Доска и чат работают и так.</p>
              </div>
            )}
            {waiting && (
              <p className="flex gap-2.5 rounded-xl bg-tint px-4 py-3 text-[15px] text-ink" role="status">
                <LoaderCircle size={18} className="mt-0.5 shrink-0 animate-spin text-brand-700" />
                Репетитор ещё не начал урок. Как только он зайдёт, вы подключитесь сами — страницу обновлять не нужно.
              </p>
            )}
            {devNote && !boardOnly && !noVideo && (
              <p className="flex gap-2.5 rounded-xl bg-[#fff4cc] px-4 py-3 text-[15px] text-ink">
                <Info size={18} className="mt-0.5 shrink-0" />
                {devNote}
              </p>
            )}
            {!user && (
              <label className="field">
                Как вас зовут
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={60} placeholder="Имя и фамилия" autoComplete="name" />
              </label>
            )}
            {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-[15px] text-danger-600">{error}</p>}
            {noVideo ? (
              <>
                {gate !== 'phone' && (
                  <Link href={`/billing?back=/lesson/${lesson.code}`} className="btn btn-primary btn-lg">
                    Выбрать тариф
                  </Link>
                )}
                <button type="submit" className="btn btn-line h-auto min-h-12 py-3 text-center leading-tight whitespace-normal" disabled={!ready}>
                  <PenLine size={18} /> Открыть доску и чат без видео
                </button>
              </>
            ) : (
              <>
                <button type="submit" className="btn btn-primary btn-lg h-auto min-h-14 py-3 text-center leading-tight whitespace-normal" disabled={busy || !ready || waiting}>
                  {busy
                    ? 'Подключаемся…'
                    : waiting
                      ? 'Ждём репетитора…'
                      : boardOnly
                        ? 'Открыть доску и чат'
                        : gate === 'trial'
                          ? `Начать пробный урок — ${TRIAL_MIN} минут`
                          : trialEnds !== null
                            ? 'Продолжить пробный урок'
                            : user?.isOwner
                              ? 'Начать урок'
                              : 'Войти в урок'}
                </button>
                <WaitHint show={!ready} />
                {(fallback || waiting || gate === 'trial') && !boardOnly && (
                  <button
                    type="button"
                    className="btn btn-line h-auto min-h-12 py-3 text-center leading-tight whitespace-normal"
                    disabled={busy}
                    onClick={(e) => {
                      if (e.currentTarget.form && !e.currentTarget.form.reportValidity()) return;
                      board();
                    }}
                  >
                    <PenLine size={18} /> Открыть доску и чат без видео
                  </button>
                )}
              </>
            )}
            {user?.isOwner && <CopyInvite code={lesson.code} />}
            {!user && (
              <p className="text-[14px] text-ink-3">
                Есть аккаунт?{' '}
                <Link href={`/login?next=/lesson/${lesson.code}`} className="text-brand-700 hover:underline">
                  Войдите
                </Link>{' '}
                — конспект урока сохранится в кабинете.
              </p>
            )}
          </form>
        </div>
      </main>
    </div>
  );
}

const OFF_TEXT = 'Видеосвязь в этом уроке сейчас недоступна. Можно заниматься на доске и в чате.';

export function LessonClient({
  lesson,
  user,
  livekit,
  ai,
  removed = false,
  locked = false,
  access: initialAccess = null,
  guest = null,
}: {
  lesson: LessonInfo;
  user: { name: string; isOwner: boolean } | null;
  livekit: boolean;
  ai: boolean;
  /** Репетитор удалил этого человека из урока */
  removed?: boolean;
  locked?: boolean;
  /** Репетитору: есть ли видео по его тарифу (подтвердить телефон, пробный урок, подписка) */
  access?: VideoState | null;
  /** Ученику и гостю: есть ли видео в уроке */
  guest?: GuestAccess | null;
}) {
  const off = Boolean(guest && !guest.ok && guest.reason === 'off');
  const [stage, setStage] = useState<'prejoin' | 'room' | 'board' | 'left' | 'removed' | 'ended'>(removed ? 'removed' : 'prejoin');
  const [conn, setConn] = useState<Conn | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [prefs, setPrefs] = useState({ mic: true, cam: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(!livekit ? 'Видеосвязь ещё не настроена на сервере. Можно открыть доску без видео.' : off ? OFF_TEXT : '');
  const [notice, setNotice] = useState('');
  const [guestName, setGuestName] = useState('');
  const [soloId] = useState(() => `local-${Math.random().toString(36).slice(2, 8)}`);
  const [videoFailed, setVideoFailed] = useState(off);
  const [access, setAccess] = useState<VideoState | null>(initialAccess);
  // Ученик пришёл раньше репетитора: пробуем подключиться снова, пока репетитор не начнёт урок
  const [waiting, setWaiting] = useState(false);
  const pending = useRef<{ name: string; mic: boolean; cam: boolean } | null>(null);
  const inFlight = useRef(false);
  // О каких устройствах уже сказали при входе (дальше ошибки кнопок «Микрофон»/«Камера» показывает сама кнопка)
  const reported = useRef(new Set<string>());
  const openBoard = (n: string) => {
    setWaiting(false);
    setGuestName(n);
    setStage('board');
  };

  async function join(name: string, mic: boolean, cam: boolean, trial = false, quiet = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    if (!quiet) {
      setBusy(true);
      setError('');
    }
    try {
      const res = await fetch(`/api/lessons/${lesson.code}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, trial }),
      });
      const out = await res.json().catch(() => ({}));
      if (out.removed) return setStage('removed');
      if (out.locked) {
        setWaiting(false);
        return setError(out.error);
      }
      if (res.status === 402 && out.noVideo) {
        // Репетитору: что нужно, чтобы включить видео (телефон, пробный урок, тариф) — показываем на этой же странице
        if (user?.isOwner && out.noVideo !== 'limit') return setAccess({ ok: false, reason: out.noVideo });
        if (out.noVideo === 'wait') {
          pending.current = { name, mic, cam };
          return setWaiting(true);
        }
        setWaiting(false);
        setError(out.error || OFF_TEXT);
        setVideoFailed(true);
        return;
      }
      if (!res.ok) throw new Error(out.error || 'Не удалось подключиться');
      setWaiting(false);
      pending.current = null;
      // Чего нет на компьютере — не включаем, чтобы урок не обрывался из-за камеры или микрофона
      const d = await probeDevices();
      setNotice(missingText(d, mic, cam));
      setPrefs({ mic: mic && d.mic, cam: cam && d.cam });
      reported.current.clear();
      setRoom(new Room(roomOptions()));
      // Адрес видеосервера может быть относительным («/» — тот же сайт, что и урок: так работает npm run share)
      setConn({ ...out, url: new URL(out.url || '/', window.location.href).href, trialEndsAt: out.trialEndsAt ?? null });
      setStage('room');
    } catch (e) {
      // Пока ждём репетитора, случайная ошибка сети не страшна: попробуем снова через несколько секунд
      if (quiet) return;
      setError((e as Error).message);
      setVideoFailed(true);
    } finally {
      inFlight.current = false;
      if (!quiet) setBusy(false);
    }
  }

  const retry = useRef(join);
  retry.current = join;
  useEffect(() => {
    if (!waiting || stage !== 'prejoin') return;
    const t = setInterval(() => {
      const p = pending.current;
      if (p) retry.current(p.name, p.mic, p.cam, false, true);
    }, 7000);
    return () => clearInterval(t);
  }, [waiting, stage]);

  // Пробный урок: репетитор мог оформить подписку в соседней вкладке — тогда видео не выключаем
  const trialEndsAt = conn?.trialEndsAt ?? null;
  useEffect(() => {
    if (stage !== 'room' || !trialEndsAt) return;
    const check = () =>
      fetch(`/api/lessons/${lesson.code}/access`)
        .then((r) => r.json() as Promise<VideoState>)
        .then((s) => {
          if (s.ok && s.via === 'plan') setConn((c) => c && { ...c, trialEndsAt: null });
        })
        .catch(() => {});
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, [stage, trialEndsAt, lesson.code]);

  /** Время пробного урока вышло: просим сервер закрыть видеокомнату (или узнаём, что подписка уже есть). */
  async function trialEnd() {
    try {
      const res = await fetch(`/api/lessons/${lesson.code}/access`, { method: 'POST' });
      const out = (await res.json()) as { state?: VideoState };
      if (out.state?.ok && out.state.via === 'plan') setConn((c) => c && { ...c, trialEndsAt: null });
    } catch {
      /* видеокомнату закроет сервер */
    }
  }

  if (stage === 'removed')
    return (
      <div className="grid min-h-dvh place-items-center bg-mist p-6 text-center">
        <div className="card max-w-[460px] p-8">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-danger-soft text-danger-600">
            <UserX size={26} />
          </span>
          <h1 className="mt-4 text-2xl font-medium">Репетитор удалил вас из урока</h1>
          <p className="mt-2 text-ink-2">Зайти снова по этой ссылке не получится. Если это ошибка, напишите репетитору — он может вернуть вас.</p>
          <div className="mt-6 flex justify-center">
            <Link href={user ? '/dashboard' : '/'} className="btn btn-primary">
              {user ? 'В кабинет' : 'На главную'}
            </Link>
          </div>
        </div>
      </div>
    );

  if (stage === 'ended')
    return (
      <div className="grid min-h-dvh place-items-center bg-mist p-6 text-center">
        <div className="card max-w-[480px] p-8">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-tint text-brand-700">
            <VideoOff size={26} />
          </span>
          <h1 className="mt-4 text-2xl font-medium">{user?.isOwner ? 'Пробный урок закончился' : 'Видеосвязь в уроке завершена'}</h1>
          <p className="mt-2 text-ink-2">
            {user?.isOwner
              ? `Видео выключилось, а доска и чат остались — можно продолжить без видео. Чтобы проводить уроки с видео, выберите тариф: ${PRICES}.`
              : 'Доска и чат сохранены — можно продолжить урок без видео.'}
          </p>
          <div className="mx-auto mt-6 grid max-w-[320px] gap-2">
            {user?.isOwner && (
              <Link href={`/billing?back=/lesson/${lesson.code}`} className="btn btn-primary">
                Выбрать тариф
              </Link>
            )}
            <button type="button" className={`btn ${user?.isOwner ? 'btn-soft' : 'btn-primary'}`} onClick={() => openBoard(user?.name || conn?.name || guestName)}>
              <PenLine size={18} /> Открыть доску и чат
            </button>
            <Link href={user ? '/dashboard' : '/'} className="btn btn-line">
              {user ? 'В кабинет' : 'На главную'}
            </Link>
          </div>
        </div>
      </div>
    );

  if (stage === 'left')
    return (
      <div className="grid min-h-dvh place-items-center bg-mist p-6 text-center">
        <div className="card max-w-[440px] p-8">
          <h1 className="text-2xl font-medium">Вы вышли из урока</h1>
          <p className="mt-2 text-ink-2">{notice || 'Доска и чат сохранены.'}</p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button type="button" className="btn btn-primary" onClick={() => setStage('prejoin')}>
              Вернуться в урок
            </button>
            <Link href={user ? '/dashboard' : '/'} className="btn btn-line">
              {user ? 'В кабинет' : 'На главную'}
            </Link>
          </div>
        </div>
      </div>
    );

  if (stage === 'board')
    return (
      <RoomUI
        lesson={lesson}
        me={{ identity: soloId, name: user?.name || guestName || 'Гость', isHost: Boolean(user?.isOwner) }}
        ai={ai}
        onLeave={() => setStage('left')}
      />
    );

  if (stage === 'room' && conn && room)
    return (
      <LiveKitRoom
        serverUrl={conn.url}
        token={conn.token}
        connect
        audio={prefs.mic}
        video={prefs.cam}
        room={room}
        onDisconnected={async (reason) => {
          if (reason === DisconnectReason.PARTICIPANT_REMOVED) return setStage('removed');
          // Видеокомнату закрыли (например, закончился пробный урок) — объясняем, что доска и чат остались
          if (reason === DisconnectReason.ROOM_DELETED) {
            const s = await fetch(`/api/lessons/${lesson.code}/access`)
              .then((r) => r.json() as Promise<VideoState | GuestAccess>)
              .catch(() => null);
            if (s && !s.ok) {
              if (user?.isOwner) setAccess(s as VideoState);
              return setStage('ended');
            }
          }
          setStage('left');
        }}
        onMediaDeviceFailure={(failure, kind) => {
          const name = { [MediaDeviceFailure.NotFound]: 'NotFoundError', [MediaDeviceFailure.PermissionDenied]: 'NotAllowedError', [MediaDeviceFailure.DeviceInUse]: 'NotReadableError' }[
            failure as string
          ];
          const k = kind === 'audioinput' ? 'mic' : kind === 'videoinput' ? 'cam' : 'both';
          // Здесь — только то, что включалось при входе и один раз; нажатия на кнопки объясняет всплывающая подсказка
          const wanted = k === 'mic' ? prefs.mic : k === 'cam' ? prefs.cam : prefs.mic || prefs.cam;
          if (!wanted || reported.current.has(k)) return;
          reported.current.add(k);
          setNotice(mediaErrorText({ name }, k));
        }}
        onError={(e) => {
          console.warn('LiveKit:', e.name, e.message);
          // Не включилась камера или микрофон — остаёмся в уроке и объясняем, в чём дело
          if (isMediaError(e) || room.state === ConnectionState.Connected) {
            const lp = room.localParticipant;
            const kind = lp.lastCameraError && lp.lastMicrophoneError ? 'both' : lp.lastCameraError ? 'cam' : lp.lastMicrophoneError ? 'mic' : 'both';
            setNotice(mediaErrorText(lp.lastCameraError ?? lp.lastMicrophoneError ?? e, kind));
            return;
          }
          setError(connectErrorText(e, conn.isHost));
          setVideoFailed(true);
          setStage('prejoin');
        }}
        className="h-dvh"
      >
        <RoomUI
          lesson={lesson}
          me={{ identity: conn.identity, name: conn.name, isHost: conn.isHost }}
          ai={ai}
          notice={notice}
          onLeave={() => setStage('left')}
          trialEndsAt={conn.trialEndsAt}
          onTrialEnd={trialEnd}
        />
        <RoomAudioRenderer />
        <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center">
          <StartAudio label="Включить звук" className="btn btn-primary shadow-lift" />
        </div>
      </LiveKitRoom>
    );

  return (
    <PreJoin
      lesson={lesson}
      user={user}
      onJoin={join}
      onBoard={openBoard}
      busy={busy}
      error={error}
      boardOnly={!livekit}
      fallback={livekit && videoFailed}
      locked={locked}
      access={access}
      onAccess={(s) => {
        setError('');
        setAccess(s);
      }}
      waiting={waiting}
    />
  );
}
