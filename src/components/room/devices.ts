// Камера и микрофон: проверка, есть ли они, и понятные сообщения об ошибках.

export type Devices = { secure: boolean; mic: boolean; cam: boolean };

/** Есть ли на компьютере микрофон и камера. Браузер отвечает без запроса разрешений. */
export async function probeDevices(): Promise<Devices> {
  const secure = typeof window !== 'undefined' && window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);
  if (!secure) return { secure: false, mic: false, cam: false };
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    return { secure, mic: list.some((d) => d.kind === 'audioinput'), cam: list.some((d) => d.kind === 'videoinput') };
  } catch {
    return { secure, mic: true, cam: true }; // не знаем — пусть попробует подключить
  }
}

const MEDIA_ERRORS = ['NotFoundError', 'DevicesNotFoundError', 'NotAllowedError', 'PermissionDeniedError', 'NotReadableError', 'TrackStartError', 'OverconstrainedError', 'AbortError', 'SecurityError'];

/** Ошибка из-за камеры или микрофона (а не из-за связи с видеосервером)? */
export function isMediaError(e: unknown) {
  const err = e as { name?: string; message?: string } | null;
  if (!err) return false;
  if (MEDIA_ERRORS.includes(err.name || '')) return true;
  if (err.name === 'DeviceUnsupportedError') return true;
  // Страница открыта не по https — в браузере нет navigator.mediaDevices
  return /getUserMedia|mediaDevices|enumerateDevices|Requested device not found|Permission denied/i.test(err.message || '');
}

const NAMES = { mic: 'Микрофон', cam: 'Камера', both: 'Камера и микрофон' } as const;
const GENITIVE = { mic: 'микрофону', cam: 'камере', both: 'камере и микрофону' } as const;

/** Понятный текст ошибки камеры или микрофона. */
export function mediaErrorText(e: unknown, kind: keyof typeof NAMES = 'both') {
  const name = (e as { name?: string } | null)?.name || '';
  if (typeof window !== 'undefined' && (!window.isSecureContext || !navigator.mediaDevices))
    return `${NAMES[kind]} ${kind === 'both' ? 'работают' : 'работает'} только на защищённой странице (адрес начинается с https://) или на localhost. Откройте урок по такой ссылке — доска и чат работают и так.`;
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError')
    return `${NAMES[kind]} не ${kind === 'both' ? 'найдены' : kind === 'cam' ? 'найдена' : 'найден'}. Подключите ${kind === 'mic' ? 'его' : kind === 'cam' ? 'её' : 'их'} и включите снова — а пока можно слушать, писать в чат и рисовать на доске.`;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError')
    return `Браузер не дал доступ к ${GENITIVE[kind]}. Нажмите на значок замка или камеры слева от адреса сайта, разрешите доступ и включите снова.`;
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError')
    return `${NAMES[kind]} ${kind === 'both' ? 'заняты' : kind === 'cam' ? 'занята' : 'занят'} другой программой (Zoom, Skype, другая вкладка). Закройте её и включите снова.`;
  return `Не удалось включить ${kind === 'mic' ? 'микрофон' : kind === 'cam' ? 'камеру' : 'камеру и микрофон'}. Проверьте, что ${kind === 'both' ? 'они подключены' : kind === 'cam' ? 'она подключена' : 'он подключён'}, и попробуйте снова.`;
}

/** Что сказать, если части устройств нет — человек всё равно заходит в урок. */
export function missingText(d: Devices, wantMic: boolean, wantCam: boolean) {
  if (!d.secure && (wantMic || wantCam)) return mediaErrorText(null, 'both');
  const noMic = wantMic && !d.mic;
  const noCam = wantCam && !d.cam;
  if (noMic && noCam) return 'Камера и микрофон не найдены — вы в уроке без них: можно видеть и слышать собеседника, писать в чат и рисовать на доске.';
  if (noCam) return 'Камера не найдена — вы в уроке без видео. Вас слышно, доска и чат работают.';
  if (noMic) return 'Микрофон не найден — вас не слышно. Можно писать в чат; подключите микрофон и включите его кнопкой внизу.';
  return '';
}
