import { getUser } from '@/lib/auth';
import { one } from '@/lib/db';
import { openThread } from '@/lib/messages';
import { IMAGE_TYPES } from '@/lib/msgfile';

const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });

/**
 * Файл из переписки. Открыть его могут только участники переписки (и автор, пока сообщение не отправлено).
 * Картинки показываем в браузере, остальное — только скачивание: так из файла не выполнится никакой код.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return notFound();
  const user = await getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const meta = await one<{ uploader_id: string | null; thread_id: string | null; name: string; mime: string }>(
    'select uploader_id, thread_id, name, mime from message_files where id = $1',
    [id],
  );
  if (!meta) return notFound();
  const allowed = meta.thread_id ? Boolean(await openThread(user, meta.thread_id)) : meta.uploader_id === user.id;
  if (!allowed) return notFound();
  const row = await one<{ data: Uint8Array }>('select data from message_files where id = $1', [id]);
  if (!row) return notFound();

  const inline = IMAGE_TYPES.includes(meta.mime) && new URL(req.url).searchParams.get('download') !== '1';
  const ascii = meta.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return new Response(new Uint8Array(row.data), {
    headers: {
      'content-type': inline ? meta.mime : 'application/octet-stream',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(meta.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cross-origin-resource-policy': 'same-origin',
    },
  });
}
