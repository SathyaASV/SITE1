import crypto from 'node:crypto';
import { UUID, store, notifyOnce } from '../lib/common.mjs';

export const config = { path: '/api/submit' };

const json = (code, o) => new Response(JSON.stringify(o), { status: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export default async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false });
  let body;
  try {
    const raw = await req.text();
    if (raw.length > 65536) throw 0;
    body = JSON.parse(raw);
    const { answers } = body;
    if (!Array.isArray(answers) || !answers.length || answers.length > 30 || answers.some((a) => !a || typeof a.q !== 'string' || typeof a.a !== 'string')) throw 0;
  } catch { return json(400, { ok: false }); }

  const clean = body.answers.map((a) => ({ id: String(a.id || '').slice(0, 40), q: a.q.slice(0, 300), a: a.a.slice(0, 4000) }));
  // The page sends one stable id per visit, so retries reuse it and are de-duplicated.
  const id = typeof body.sid === 'string' && UUID.test(body.sid.toLowerCase()) ? body.sid.toLowerCase() : crypto.randomUUID();
  try {
    // onlyIfNew is atomic: a retried/double request never creates a second copy.
    await store().setJSON(`sub/${id}`, { id, created_at: new Date().toISOString(), origin: new URL(req.url).origin, answers: clean }, { onlyIfNew: true });
    // Also runs on retries, so a retry can complete a notification that failed the first time. Sent at most once.
    await notifyOnce(id, new URL(req.url).origin);
  } catch (e) {
    console.error('submit failed', e);
    return json(500, { ok: false }); // frontend shows its "try again" button; answers are still on her screen
  }
  return json(200, { ok: true });
};
