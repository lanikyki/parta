import { aiConfigured } from '@/lib/ai';
import { db } from '@/lib/db';
import { livekitConfigured } from '@/lib/livekit';

export async function GET() {
  let database = 'ok';
  try {
    await (await db()).query('select 1');
  } catch {
    database = 'error';
  }
  return Response.json({
    database,
    storage: process.env.DATABASE_URL ? 'postgres' : 'local',
    video: livekitConfigured(),
    ai: aiConfigured(),
  });
}
