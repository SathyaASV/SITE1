import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const { PORT = 3000, ADMIN_PASSWORD, ADMIN_USER = 'admin', DB_PATH = 'data/submissions.db', NOTIFY_URL, NOTIFY_TOKEN, REPORT_SECRET, TRUST_PROXY_HOPS = '1' } = process.env;
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || (process.env.FLY_APP_NAME ? `https://${process.env.FLY_APP_NAME}.fly.dev` : '')).replace(/\/$/, '');
const adminOn = !!ADMIN_PASSWORD && ADMIN_PASSWORD.length >= 12 && !/^change-me/.test(ADMIN_PASSWORD);
if (!adminOn) console.warn('WARNING: /admin and report links disabled. Set ADMIN_PASSWORD (12+ chars, not the placeholder).');
if (NOTIFY_URL && !PUBLIC_URL) console.warn('WARNING: PUBLIC_URL not set, so notifications will not carry a tap-to-open report link.');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// Storage layer (SQLite on a persistent disk; jsonl fallback only for very old Node).
let store;
try {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(DB_PATH);
  db.exec('CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY, created_at TEXT NOT NULL, answers TEXT NOT NULL)');
  try { db.exec('ALTER TABLE submissions ADD COLUMN notified INTEGER NOT NULL DEFAULT 0'); db.exec('UPDATE submissions SET notified=1'); } catch { /* already migrated */ }
  const ins = db.prepare('INSERT OR IGNORE INTO submissions(id,created_at,answers) VALUES(?,?,?)');
  const all = db.prepare('SELECT id,created_at,answers FROM submissions ORDER BY created_at DESC');
  const one = db.prepare('SELECT id,created_at,answers FROM submissions WHERE id=?');
  const pend = db.prepare('SELECT id FROM submissions WHERE notified=0');
  const mark = db.prepare('UPDATE submissions SET notified=1 WHERE id=?');
  const parse = (r) => r && { ...r, answers: JSON.parse(r.answers) };
  store = {
    add: (r) => ins.run(r.id, r.created_at, JSON.stringify(r.answers)).changes > 0,
    list: () => all.all().map(parse),
    get: (id) => parse(one.get(id)),
    pending: () => pend.all().map((r) => r.id),
    mark: (id) => mark.run(id),
  };
} catch {
  const f = DB_PATH + '.jsonl';
  const list = () => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse).reverse() : []);
  store = { add: (r) => { if (list().some((x) => x.id === r.id)) return false; fs.appendFileSync(f, JSON.stringify(r) + '\n'); return true; }, list, get: (id) => list().find((x) => x.id === id), pending: () => [], mark() {} };
}

const page = fs.readFileSync(new URL('./public/index.html', import.meta.url));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sha = (x) => crypto.createHash('sha256').update(x).digest();
const authed = (req) => {
  if (!adminOn) return false;
  const [u, ...p] = Buffer.from((req.headers.authorization || '').slice(6), 'base64').toString().split(':');
  const a = crypto.timingSafeEqual(sha(u || ''), sha(ADMIN_USER));
  const b = crypto.timingSafeEqual(sha(p.join(':')), sha(ADMIN_PASSWORD));
  return a && b;
};
// Signed per-submission report link: unguessable, derived from a server-side secret.
const secret = REPORT_SECRET || 'report:' + ADMIN_PASSWORD;
const tok = (id) => crypto.createHmac('sha256', secret).update(id).digest('hex').slice(0, 32);
const tokOk = (id, k) => typeof k === 'string' && k.length === 32 && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(tok(id)));

const ipOf = (req) => {
  const xs = (req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean), n = +TRUST_PROXY_HOPS;
  return (n > 0 && xs.length ? xs[Math.max(0, xs.length - n)] : req.socket.remoteAddress) || 'x';
};
const mkLimiter = (max) => { const m = new Map(); setInterval(() => m.clear(), 3600e3).unref(); return { hit: (ip) => { const n = (m.get(ip) || 0) + 1; m.set(ip, n); return n > max; }, over: (ip) => (m.get(ip) || 0) > max }; };
const submitLim = mkLimiter(20), failLim = mkLimiter(15);

// Push notification: never contains her answers, only a tap-to-open link.
async function push(title, body, link) {
  if (!NOTIFY_URL) return false;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(NOTIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(8000), headers: { Title: title, Priority: 'high', Tags: 'heart', ...(link && { Click: link }), ...(NOTIFY_TOKEN && { Authorization: `Bearer ${NOTIFY_TOKEN}` }) } });
      if (r.ok) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  return false;
}
async function notify(id) {
  const link = PUBLIC_URL && adminOn ? `${PUBLIC_URL}/report/${id}?k=${tok(id)}` : '';
  if (await push('Tharika submitted!', 'Tharika just submitted her answers 💗 Tap to read them.', link)) store.mark(id);
  else console.error('notify failed for', id.slice(0, 8), '(will retry)');
}
const retryPending = async () => { if (NOTIFY_URL) for (const id of store.pending()) await notify(id); };
retryPending(); setInterval(retryPending, 600e3).unref();

const CSP_PAGE = "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'";
const CSP_ADMIN = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'";
const base = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' };
const send = (res, code, body, type = 'text/plain; charset=utf-8', extra = {}) => { res.writeHead(code, { ...base, 'Content-Type': type, ...extra }); res.end(body); };
const priv = { 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP_ADMIN };

const css = '<style>body{font:16px/1.5 system-ui;background:#fff0f5;color:#3a1c30;max-width:760px;margin:0 auto;padding:16px}article{background:#fff;border-radius:18px;padding:16px 20px;margin:16px 0;box-shadow:0 6px 24px #d6457a22}h2{font-size:18px;color:#d6457a;margin:0 0 8px}small{color:#999;font-weight:400}.q{margin:12px 0}.q b{font-size:14px;color:#7a4a68}.q p{margin:2px 0;white-space:pre-wrap}button{font:inherit;padding:10px 16px;border:0;border-radius:99px;background:#d6457a;color:#fff}</style>';
const card = (r) => `<article><h2>${esc(new Date(r.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))} <small>#${esc(r.id.slice(0, 8))}</small></h2>${r.answers.map((a) => `<div class="q"><b>${esc(a.q)}</b><p>${esc(a.a)}</p></div>`).join('')}</article>`;
const shell = (inner) => `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=robots content=noindex><title>Submissions</title>${css}<h1>💌 Tharika's answers</h1>${inner}`;
const adminHtml = (t) => shell(`<form method=post action=/admin/test-notify><button>Send test notification</button> ${t === '1' ? '✅ sent, check your phone' : t === '0' ? '❌ failed, check NOTIFY_URL' : ''}</form>${store.list().map(card).join('') || '<p>No submissions yet.</p>'}`);

http.createServer((req, res) => {
  req.on('error', () => {});
  const [url, qs = ''] = req.url.split('?'), q = new URLSearchParams(qs);
  if (req.method === 'GET' && url === '/') return send(res, 200, page, 'text/html; charset=utf-8', { 'Content-Security-Policy': CSP_PAGE });
  if (req.method === 'GET' && url === '/healthz') return send(res, 200, 'ok');
  if (req.method === 'GET' && url === '/favicon.ico') return send(res, 204, '');
  const ip = ipOf(req);
  if (url === '/admin' || url === '/admin/test-notify') {
    if (!adminOn) return send(res, 503, 'Admin disabled: set ADMIN_PASSWORD.');
    if (failLim.over(ip)) return send(res, 429, 'Too many attempts');
    if (!authed(req)) { failLim.hit(ip); return send(res, 401, 'Login required', 'text/plain', { 'WWW-Authenticate': 'Basic realm="admin", charset="UTF-8"' }); }
    if (req.method === 'GET' && url === '/admin') return send(res, 200, adminHtml(q.get('t')), 'text/html; charset=utf-8', priv);
    if (req.method === 'POST') return push('Test notification', 'It works! Tap to open the admin page.', PUBLIC_URL && PUBLIC_URL + '/admin').then((ok) => send(res, 303, '', 'text/plain', { Location: '/admin?t=' + (ok ? 1 : 0) }));
  }
  const m = req.method === 'GET' && url.match(/^\/report\/([0-9a-f-]{36})$/);
  if (m) {
    if (!adminOn || failLim.over(ip)) return send(res, 404, 'Not found');
    const r = tokOk(m[1], q.get('k')) && store.get(m[1]);
    if (!r) { failLim.hit(ip); return send(res, 404, 'Not found'); }
    return send(res, 200, shell(card(r)), 'text/html; charset=utf-8', priv);
  }
  if (req.method === 'POST' && url === '/api/submit') {
    if (submitLim.hit(ip)) return send(res, 429, 'Slow down');
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 65536) req.destroy(); });
    req.on('end', () => {
      try {
        const { answers, sid } = JSON.parse(raw);
        if (!Array.isArray(answers) || !answers.length || answers.length > 30 || answers.some((a) => !a || typeof a.q !== 'string' || typeof a.a !== 'string')) throw 0;
        const clean = answers.map((a) => ({ id: String(a.id || '').slice(0, 40), q: a.q.slice(0, 300), a: a.a.slice(0, 4000) }));
        const id = typeof sid === 'string' && /^[0-9a-f-]{36}$/i.test(sid) ? sid.toLowerCase() : crypto.randomUUID();
        if (store.add({ id, created_at: new Date().toISOString(), answers: clean })) notify(id); // retried submits are de-duplicated by sid
        send(res, 200, JSON.stringify({ ok: true }), 'application/json');
      } catch { send(res, 400, JSON.stringify({ ok: false }), 'application/json'); }
    });
    return;
  }
  send(res, 404, 'Not found');
}).listen(PORT, () => console.log(`Running on :${PORT}`));
