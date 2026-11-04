'use client';

import { Camera, Mic, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CAM_KEY, MIC_KEY, mediaErrorText, saveDevice as save, savedDevice as saved } from '@/components/room/devices';

/** Проверка камеры и микрофона до урока: видно себя, полоска показывает громкость. */
export function DeviceCheck() {
  const [on, setOn] = useState(false);
  const [error, setError] = useState('');
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cam, setCam] = useState('');
  const [mic, setMic] = useState('');
  const [level, setLevel] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const audio = useRef<{ ctx: AudioContext; raf: number } | null>(null);

  useEffect(() => {
    setCam(saved(CAM_KEY));
    setMic(saved(MIC_KEY));
    return () => stop();
  }, []);

  function stop() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (audio.current) {
      cancelAnimationFrame(audio.current.raf);
      audio.current.ctx.close().catch(() => {});
      audio.current = null;
    }
    setLevel(0);
    setOn(false);
  }

  async function start(camId = cam, micId = mic) {
    stop();
    setError('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return setError(mediaErrorText(null, 'both'));
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia({
        video: camId ? { deviceId: { ideal: camId } } : true,
        audio: micId ? { deviceId: { ideal: micId } } : true,
      });
    } catch (e) {
      // Может, нет камеры — попробуем хотя бы микрофон
      try {
        s = await navigator.mediaDevices.getUserMedia({ audio: micId ? { deviceId: { ideal: micId } } : true });
        setError(mediaErrorText(e, 'cam'));
      } catch {
        return setError(mediaErrorText(e, 'both'));
      }
    }
    stream.current = s;
    setOn(true);
    if (video.current) video.current.srcObject = s;
    const list = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    setCams(list.filter((d) => d.kind === 'videoinput' && d.deviceId));
    setMics(list.filter((d) => d.kind === 'audioinput' && d.deviceId));
    const vt = s.getVideoTracks()[0]?.getSettings().deviceId;
    const at = s.getAudioTracks()[0]?.getSettings().deviceId;
    if (vt) setCam(vt);
    if (at) setMic(at);
    // Громкость микрофона
    if (s.getAudioTracks().length) {
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 64));
        if (audio.current) audio.current.raf = requestAnimationFrame(tick);
      };
      audio.current = { ctx, raf: requestAnimationFrame(tick) };
    }
  }

  const label = (d: MediaDeviceInfo, i: number, kind: string) => d.label || `${kind} ${i + 1}`;

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[240px_minmax(0,1fr)]">
        <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-brand-950">
          <video ref={video} autoPlay playsInline muted className={`h-full w-full -scale-x-100 object-cover ${on ? '' : 'hidden'}`} />
          {!on && (
            <span className="absolute inset-0 grid place-items-center text-white/60">
              <Camera size={28} />
            </span>
          )}
        </div>
        <div className="grid content-start gap-3">
          {on && (cams.length > 0 || mics.length > 0) ? (
            <>
              {cams.length > 0 && (
                <label className="field">
                  <span>Камера</span>
                  <select
                    className="input"
                    value={cam}
                    onChange={(e) => {
                      setCam(e.target.value);
                      save(CAM_KEY, e.target.value);
                      start(e.target.value, mic);
                    }}
                  >
                    {cams.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {label(d, i, 'Камера')}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {mics.length > 0 && (
                <label className="field">
                  <span>Микрофон</span>
                  <select
                    className="input"
                    value={mic}
                    onChange={(e) => {
                      setMic(e.target.value);
                      save(MIC_KEY, e.target.value);
                      start(cam, e.target.value);
                    }}
                  >
                    {mics.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {label(d, i, 'Микрофон')}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="flex items-center gap-3">
                <Mic size={18} className="shrink-0 text-ink-3" />
                <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-mist" aria-label="Громкость микрофона">
                  <span className="block h-full rounded-full bg-brand transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
                </span>
              </div>
              <p className="text-[13px] text-ink-3">Скажите что-нибудь — полоска должна двигаться. Выбор сохранится для уроков в этом браузере.</p>
            </>
          ) : (
            <p className="text-[15px] text-ink-2">Проверьте до урока, что браузер видит камеру и слышит микрофон. Браузер спросит разрешение — нажмите «Разрешить».</p>
          )}
          <div>
            {on ? (
              <button type="button" className="btn btn-line btn-sm" onClick={stop}>
                <Square size={14} fill="currentColor" /> Остановить проверку
              </button>
            ) : (
              <button type="button" className="btn btn-soft btn-sm" onClick={() => start()}>
                <Camera size={16} /> Проверить камеру и микрофон
              </button>
            )}
          </div>
        </div>
      </div>
      {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger-600">{error}</p>}
    </div>
  );
}
