import { store, notifyOnce, env } from '../lib/common.mjs';

// Safety net: every 10 minutes, re-send any notification that failed earlier.
export const config = { schedule: '*/10 * * * *' };

export default async () => {
  const s = store();
  const { blobs } = await s.list({ prefix: 'sub/' });
  for (const { key } of blobs) await notifyOnce(key.slice(4), env('PUBLIC_URL'));
  return new Response('ok');
};
