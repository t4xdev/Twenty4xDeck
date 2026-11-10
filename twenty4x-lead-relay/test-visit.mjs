// Tests the tracked-link visit flow (POST /visit, GET /visits) against a local SQLite copy of schema.sql.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import w from './src/worker.js';
// Cloudflare-only API; a simple stand-in for Node
crypto.subtle.timingSafeEqual ??= (a, b) => Buffer.from(a).equals(Buffer.from(b));
const sql = new DatabaseSync(':memory:'); sql.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
const DB = { prepare: (q) => { const st = sql.prepare(q); let a = []; const o = {
  bind: (...x) => { a = x.map((v) => (v === undefined ? null : v)); return o; },
  run: async () => { const r = st.run(...a); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
  first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }) }; return o; } };
const env = { DB, BREVO_API_KEY: 'k', SENDER_EMAIL: 'noreply@twenty4x.net', LEAD_RECIPIENTS: 'a@twenty4x.com', VISIT_RECIPIENTS: 'pm@twenty4x.com', ALLOWED_ORIGINS: 'https://deck.twenty4x.com', ADMIN_PASSWORD: 'pw' };
let sent = []; globalThis.fetch = async (u, i) => { sent.push(JSON.parse(i.body)); return new Response('{"messageId":"x"}', { status: 201 }); };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const cf = { city: 'Dubai', region: 'Dubai', country: 'AE', postalCode: '00000', latitude: '25.07', longitude: '55.17', timezone: 'Asia/Dubai', asOrganization: 'Emirates Telecom', asn: 5384 };
const post = (body, { ua = IPHONE, origin = 'https://deck.twenty4x.com' } = {}) => {
  const r = new Request('https://relay.test/visit', { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: origin, 'User-Agent': ua, 'CF-Connecting-IP': '94.200.1.2' }, body: JSON.stringify(body) });
  Object.defineProperty(r, 'cf', { value: cf }); return w.fetch(r, env);
};
const base = { type: 'open', visitorId: 'visitor-0001', sessionId: 'session-0001', utm: { utm_source: 'email', utm_campaign: 'nov-fleet', utm_content: 'john-acme' }, page: 'https://deck.twenty4x.com/?utm_content=john-acme', screen: '390x844', language: 'en-AE', timezone: 'Asia/Dubai', touch: true };
const check = (label, cond) => { console.log(cond ? 'PASS' : 'FAIL', label); if (!cond) process.exitCode = 1; };
const body = async (r) => [r.status, await r.json()];

let [s, b] = await body(await post(base));
check('open is saved and emailed', s === 200 && b.emailed === true && sent.length === 1);
check('email goes to VISIT_RECIPIENTS', sent[0].to[0].email === 'pm@twenty4x.com');
console.log('   subject:', sent[0].subject);
check('email has location, IP, network, device', ['Dubai', '94.200.1.2', 'Emirates Telecom', 'iPhone', 'Safari 18.1', 'iOS 18.1', 'google.com/maps'].every((x) => sent[0].htmlContent.includes(x)));
[s, b] = await body(await post(base)); check('same session again: not saved twice', b.duplicate === true && sent.length === 1);
[s, b] = await body(await post({ ...base, sessionId: 'session-0002' })); check('new session (new tab) is a new unique visit: emailed', b.emailed === true && sent.length === 2);
[s, b] = await body(await post({ ...base, sessionId: 'session-0003', utm: { ...base.utm, utm_content: 'mary-bco' } })); check('different link tag: emailed', b.emailed === true && sent.length === 3);
[s, b] = await body(await post({ type: 'leave', sessionId: 'session-0001', seconds: 95 })); check('leave updates time on page', sql.prepare("SELECT seconds_on_page s FROM visits WHERE session_id='session-0001'").get().s === 95);
[s, b] = await body(await post({ ...base, sessionId: 'session-0004' }, { ua: 'Mozilla/5.0 (compatible; Microsoft Outlook SafeLinks)' })); check('scanner ignored', b.ignored === 'bot');
[s, b] = await body(await post({ ...base, sessionId: 'session-0005', utm: {} })); check('no utm tags: rejected', s === 422);
[s, b] = await body(await post(base, { origin: 'https://evil.example' })); check('other website: refused', s === 403);
const rows = sql.prepare('SELECT * FROM visits ORDER BY id').all();
check('3 visits stored, all emailed', rows.length === 3 && rows.map((r) => r.email_status).join() === 'sent,sent,sent');
check('second visit marked returning', rows[1].is_return === 1);
const adm = (p, auth) => w.fetch(new Request('https://relay.test' + p, { headers: auth ? { Authorization: 'Basic ' + btoa('x:pw') } : {} }), env);
check('/visits needs password', (await adm('/visits')).status === 401);
const page = await (await adm('/visits', 1)).text(); check('/visits lists visits', page.includes('john-acme') && page.includes('mary-bco') && page.includes('1m 35s'));
const csv = await (await adm('/visits.csv', 1)).text(); check('/visits.csv exports', csv.split('\r\n').length === 4 && csv.includes('94.200.1.2'));

// ---- client links (/links) ----
const ORIGIN = 'https://relay.test';
const form = (fields, { origin = ORIGIN, auth = true } = {}) => w.fetch(new Request(ORIGIN + '/links', { method: 'POST', redirect: 'manual',
  headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', ...(auth ? { Authorization: 'Basic ' + btoa('x:pw') } : {}) },
  body: new URLSearchParams(fields) }), { ...env, PORTAL_URLS: 'https://deck.twenty4x.com/' });
check('/links needs password', (await adm('/links')).status === 401);
check('create from another website: refused', (await form({ client: 'Evil' }, { origin: 'https://evil.example' })).status === 403);
let r = await form({ client: 'Ravi Kumar', company: 'Oceanic Lines', email: 'ravi@oceanic.com', campaign: 'Nov Fleet' });
check('create link redirects back', r.status === 303 && r.headers.get('Location').startsWith('/links?created='));
const L = sql.prepare('SELECT * FROM links').get();
console.log('   link:', L.url);
check('link code is readable + unique', /^ravi-kumar-oceanic-lines-[a-z0-9]{5}$/.test(L.code));
check('link url carries the code', L.url.startsWith('https://deck.twenty4x.com/?') && new URL(L.url).searchParams.get('utm_content') === L.code && new URL(L.url).searchParams.get('utm_campaign') === 'nov-fleet');
await form({ client: 'Ravi Kumar', company: 'Oceanic Lines' });
const codes = sql.prepare('SELECT code FROM links').all(); check('same name twice: two different links', codes.length === 2 && codes[0].code !== codes[1].code);
check('empty name rejected', (await form({ client: '  ' })).headers.get('Location') === '/links?error=name');
const lp = await (await adm('/links', 1)).text(); check('/links lists link with copy button', lp.includes(L.url.replace(/&/g, '&amp;')) && lp.includes('Copy') && lp.includes('Not opened yet'));
const q = Object.fromEntries(new URL(L.url).searchParams);
sent = [];
[s, b] = await body(await post({ ...base, visitorId: 'visitor-0009', sessionId: 'session-0101', utm: q }));
check('opening the client link: emailed', b.emailed === true && sent.length === 1);
console.log('   subject:', sent[0].subject);
check('email names the client, company and full country', sent[0].subject.startsWith('Ravi Kumar opened your link') && sent[0].htmlContent.includes('Oceanic Lines') && sent[0].htmlContent.includes('United Arab Emirates') && sent[0].htmlContent.includes('First time this link was opened'));
[s, b] = await body(await post({ ...base, visitorId: 'visitor-0009', sessionId: 'session-0101', utm: q })); check('reload in same session: no second email', b.duplicate === true && sent.length === 1);
[s, b] = await body(await post({ ...base, visitorId: 'visitor-0009', sessionId: 'session-0102', utm: q })); check('new session: second email', b.emailed === true && sent.length === 2 && sent[1].htmlContent.includes('Opened 2 times'));
const lp2 = await (await adm('/links', 1)).text(); check('/links shows 2 opens and full place', lp2.includes('<b>2</b>') && lp2.includes('Dubai, Dubai, 00000, United Arab Emirates'));
const vp = await (await adm('/visits?link=' + L.code, 1)).text(); check('/visits?link= filters to that client', vp.includes('Ravi Kumar') && !vp.includes('mary-bco') && vp.includes('United Arab Emirates'));
const vcsv = await (await adm('/visits.csv', 1)).text(); check('/visits.csv has client + country name', vcsv.split('\r\n')[0].includes('client,company') && vcsv.includes('United Arab Emirates'));
r = await form({ action: 'delete', id: String(L.id) }); check('remove link', r.status === 303 && !sql.prepare('SELECT 1 FROM links WHERE id=?').get(L.id));
const { parseUA, linkCode } = await import('./src/worker.js');
console.log('   codes:', linkCode('José Ñúñez & Co.'), linkCode('株式会社'), linkCode('A very very long client name that keeps going'));
console.log('   UA samples:', JSON.stringify([
  parseUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0'),
  parseUA('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'),
  parseUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', true),
  parseUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36')]));
