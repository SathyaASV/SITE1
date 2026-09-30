import { UUID, store, tokOk, esc } from '../lib/common.mjs';



const css = '<style>body{font:16px/1.5 system-ui;background:#fff0f5;color:#3a1c30;max-width:760px;margin:0 auto;padding:16px}article{background:#fff;border-radius:18px;padding:16px 20px;margin:16px 0;box-shadow:0 6px 24px #d6457a22}h2{font-size:18px;color:#d6457a;margin:0 0 8px}small{color:#999;font-weight:400}.q{margin:12px 0}.q b{font-size:14px;color:#7a4a68}.q p{margin:2px 0;white-space:pre-wrap}</style>';

const hdr = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' };

const notFound = () => new Response('Not found', { status: 404, headers: { ...hdr, 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } });



export default async (req, context) => {
  
  const params = new URL(req.url).searchParams;
  
  const id = String(context?.params?.id || params.get('id') || '').toLowerCase();
  
  const k = params.get('k');
  
  if (req.method !== 'GET' || !UUID.test(id) || !tokOk(id, k)) return notFound();
  
  const r = await store().get(`sub/${id}`, { type: 'json' });
  
  if (!r) return notFound();
  
  const when = new Date(r.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  
  const card = `<article><h2>${esc(when)} <small>#${esc(id.slice(0, 8))}</small></h2>${r.answers.map((a) => `<div class="q"><b>${esc(a.q)}</b><p>${esc(a.a)}</p></div>`).join('')}</article>`;
  
  return new Response(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=robots content=noindex><title>Tharika's answers</title>${css}<h1>💌 Tharika's answers</h1>${card}`, {
    
    status: 200,
    
    headers: { ...hdr, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" },
    
  });
  
};














