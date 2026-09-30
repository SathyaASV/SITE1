import crypto from 'node:crypto';

import { getStore } from '@netlify/blobs';



export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;



// Overridable in tests.

let storeImpl = null;

export const setStore = (s) => { storeImpl = s; };

export const store = () => storeImpl || getStore({ name: 'submissions', consistency: 'strong' });



const env = (k) => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? '').trim();

export { env };



export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));



// Unguessable per-submission token, derived from a server-side secret (never stored, never in frontend).

export const tok = (id) => crypto.createHmac('sha256', env('REPORT_SECRET')).update(id).digest('hex').slice(0, 32);

export const tokOk = (id, k) => {
  
  if (!env('REPORT_SECRET') || typeof k !== 'string' || k.length !== 32) return false;
  
  const a = Buffer.from(k), b = Buffer.from(tok(id));
  
  return a.length === b.length && crypto.timingSafeEqual(a, b);
  
};



async function push(body, link) {
  
  const url = env('NOTIFY_URL');
  
  if (!url) return false;
  
  const token = env('NOTIFY_TOKEN');
  
  for (let i = 0; i < 2; i++) {
    
    try {
      
      const r = await fetch(url, {
        
        method: 'POST',
        
        body,
        
        signal: AbortSignal.timeout(3500),
        
        headers: { Title: 'Tharika submitted!', Priority: 'high', Tags: 'heart', ...(link && { Click: link }), ...(token && { Authorization: `Bearer ${token}` }) },
        
      });
      
      if (r.ok) return true;
      
    } catch { /* retry */ }
    
  }
  
  return false;
  
}



// Sends the notification exactly once per submission (claim + done markers), safe to call repeatedly.

export async function notifyOnce(id, origin) {
  
  const s = store();
  
  if (await s.get(`done/${id}`)) return 'already';
  
  if (!env('REPORT_SECRET') || !env('NOTIFY_URL')) { console.error('REPORT_SECRET / NOTIFY_URL not configured; submission saved but not notified'); return 'unconfigured'; }
  
  let claim = await s.setJSON(`claim/${id}`, { t: Date.now() }, { onlyIfNew: true });
  
  if (!claim.modified) {
    
    const c = await s.get(`claim/${id}`, { type: 'json' });
    
    if (c && Date.now() - c.t < 90_000) return 'in-progress';
    
    await s.delete(`claim/${id}`); // stale claim from a crashed attempt
    
    claim = await s.setJSON(`claim/${id}`, { t: Date.now() }, { onlyIfNew: true });
    
    if (!claim.modified) return 'in-progress';
    
  }
  
  const rec = await s.get(`sub/${id}`, { type: 'json' });
  
  const base = (env('PUBLIC_URL') || origin || rec?.origin || '').replace(/\/$/, '');
  
  const link = base ? `${base}/.netlify/functions/report?id=${encodeURIComponent(id)}&k=${encod

































