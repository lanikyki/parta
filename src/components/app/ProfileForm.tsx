'use client';

import { BadgeCheck, Camera, Check, LoaderCircle, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { GRADES, gradeLabel } from '@/lib/brand';
import { AvatarCrop } from './AvatarCrop';
import { PhoneVerify } from './PhoneVerify';
import { UserAvatar } from './UserAvatar';

export type ProfileData = {
  tutor: boolean;
  name: string;
  email: string;
  avatar: string | null;
  subjects: string;
  about: string;
  grade: string;
  phone: string | null;
};

export function ProfileForm({ data }: { data: ProfileData }) {
  const router = useRouter();
  const [avatar, setAvatar] = useState(data.avatar);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState(data.name);
  const input = useRef<HTMLInputElement>(null);

  async function removeAvatar() {
    await fetch('/api/me/avatar', { method: 'DELETE' }).catch(() => null);
    setAvatar(null);
    router.refresh();
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    const f = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const res = await fetch('/api/me/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Не получилось сохранить');
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-5">
          <UserAvatar name={name || data.name} src={avatar} size={88} />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-medium">Фото</h2>
            <p className="mt-0.5 text-[14px] text-ink-3">
              {data.tutor ? 'Ученики увидят его в сообщениях и на уроке, пока камера выключена.' : 'Его увидят репетиторы в сообщениях и на уроке, пока камера выключена.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn btn-soft btn-sm" onClick={() => input.current?.click()}>
                <Camera size={16} /> {avatar ? 'Заменить фото' : 'Загрузить фото'}
              </button>
              {avatar && (
                <button type="button" className="btn btn-line btn-sm" onClick={removeAvatar}>
                  <Trash2 size={16} /> Удалить
                </button>
              )}
            </div>
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) setFile(f);
              }}
            />
          </div>
        </div>
      </section>

      <form onSubmit={onSubmit} className="card grid gap-4 p-5 sm:p-6">
        <h2 className="text-lg font-medium">Данные</h2>
        <label className="field">
          <span>Имя и фамилия</span>
          <input className="input" name="name" required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
        {data.tutor ? (
          <>
            <label className="field">
              <span>
                Предметы <span className="font-normal text-ink-3">— через запятую</span>
              </span>
              <input className="input" name="subjects" maxLength={160} defaultValue={data.subjects} placeholder="Например: математика, физика" />
            </label>
            <label className="field">
              <span>
                О себе <span className="font-normal text-ink-3">— необязательно</span>
              </span>
              <textarea className="input" name="about" rows={4} maxLength={600} defaultValue={data.about} placeholder="Опыт, подход к урокам, с кем занимаетесь" />
            </label>
          </>
        ) : (
          <label className="field">
            <span>Класс</span>
            <select className="input" name="grade" defaultValue={data.grade || ''}>
              <option value="">Не указан</option>
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {gradeLabel(g)}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="field">
          <span>Почта</span>
          <p className="flex h-12 items-center rounded-xl bg-mist px-3.5 text-[16px] font-normal text-ink-2">{data.email}</p>
          <span className="text-[13px] font-normal text-ink-3">Почту поменять нельзя — это логин. Если нужно, напишите в поддержку.</span>
        </div>
        {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger-600">{error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <LoaderCircle size={18} className="animate-spin" />} Сохранить
          </button>
          {saved && (
            <span className="inline-flex items-center gap-1.5 text-[14px] text-mint">
              <Check size={16} /> Сохранено
            </span>
          )}
        </div>
      </form>

      {data.tutor && <PhoneCard phone={data.phone} />}

      {file && (
        <AvatarCrop
          file={file}
          onClose={() => setFile(null)}
          onSaved={(url) => {
            setAvatar(url);
            setFile(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function PhoneCard({ phone: initial }: { phone: string | null }) {
  const [phone, setPhone] = useState(initial);
  const [edit, setEdit] = useState(false);
  return (
    <section id="phone" className="card scroll-mt-24 p-5 sm:p-6">
      <h2 className="text-lg font-medium">Телефон</h2>
      <p className="mt-1 max-w-[560px] text-[14px] text-ink-3">
        Номер подтверждается один раз — так пробный урок достаётся каждому репетитору только один раз. Ученикам номер не показываем.
      </p>
      {phone && !edit ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="inline-flex items-center gap-2 text-[17px] font-medium">
            {phone} <BadgeCheck size={18} className="text-mint" aria-label="Подтверждён" />
          </span>
          <button type="button" className="text-[14px] text-brand-700 hover:underline" onClick={() => setEdit(true)}>
            Сменить номер
          </button>
        </div>
      ) : (
        <div className="mt-4">
          <PhoneVerify
            onDone={(p) => {
              setPhone(p);
              setEdit(false);
            }}
          />
          {edit && (
            <button type="button" className="mt-3 text-[14px] text-ink-2 hover:text-ink" onClick={() => setEdit(false)}>
              Отмена
            </button>
          )}
        </div>
      )}
    </section>
  );
}
