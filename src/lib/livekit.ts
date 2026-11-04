import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';

export const livekitConfigured = () =>
  Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);

export const roomName = (code: string) => `lesson-${code}`;

export async function createToken(opts: { room: string; identity: string; name: string; isHost: boolean; avatar?: string | null }) {
  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: opts.identity,
    name: opts.name,
    ttl: '6h',
    // avatar — адрес фото из профиля: его видно на месте видео, когда камера выключена
    metadata: JSON.stringify({ role: opts.isHost ? 'host' : 'member', ...(opts.avatar ? { avatar: opts.avatar } : {}) }),
  });
  token.addGrant({
    room: opts.room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: opts.isHost,
  });
  return token.toJwt();
}

/** Управление комнатой с сервера (удалить участника, выключить ему микрофон). */
function rooms() {
  const url = (process.env.LIVEKIT_URL || '').replace(/^ws(s?):\/\//, 'http$1://');
  return new RoomServiceClient(url, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
}

const gone = (e: unknown) => /not.?found|404|does not exist/i.test(String((e as Error)?.message || e));

/** Убирает участников из видеокомнаты. Кого там уже нет — пропускаем. */
export async function removeFromRoom(room: string, identities: string[]) {
  if (!livekitConfigured()) return;
  const svc = rooms();
  await Promise.all(
    identities.map((id) =>
      svc.removeParticipant(room, id).catch((e) => {
        if (!gone(e)) throw e;
      }),
    ),
  );
}

/** Выключает участнику микрофон (включить обратно может только он сам). false — микрофон и так выключен. */
export async function muteMicrophone(room: string, identity: string) {
  const svc = rooms();
  const p = await svc.getParticipant(room, identity);
  const mics = p.tracks.filter((t) => t.source === TrackSource.MICROPHONE && !t.muted);
  for (const t of mics) await svc.mutePublishedTrack(room, identity, t.sid, true);
  return mics.length > 0;
}

/** Кто сейчас в видеокомнате (идентификаторы участников). Комнаты нет — пустой список. */
export async function roomIdentities(room: string) {
  if (!livekitConfigured()) return [];
  try {
    return (await rooms().listParticipants(room)).map((p) => p.identity);
  } catch (e) {
    if (gone(e)) return [];
    throw e;
  }
}

/** Закрывает видеокомнату: всех участников отключает (у них — «комната закрыта»). */
export async function closeRoom(room: string) {
  if (!livekitConfigured()) return;
  await rooms()
    .deleteRoom(room)
    .catch((e) => {
      if (!gone(e)) throw e;
    });
}
