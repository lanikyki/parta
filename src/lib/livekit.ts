import { AccessToken } from 'livekit-server-sdk';

export const livekitConfigured = () =>
  Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);

export async function createToken(opts: { room: string; identity: string; name: string; isHost: boolean }) {
  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: opts.identity,
    name: opts.name,
    ttl: '6h',
    metadata: JSON.stringify({ role: opts.isHost ? 'host' : 'member' }),
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
