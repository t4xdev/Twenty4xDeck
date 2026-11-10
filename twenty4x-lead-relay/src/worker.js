/**
 * Twenty4x lead relay: receives the website's demo-request form and emails it through Brevo.
 *
 * Why a relay: the Brevo API key must never be in the website's code, because anyone can read
 * page source. The key lives here as an encrypted Worker secret (BREVO_API_KEY).
 *
 * Environment (wrangler.toml [vars] + one secret):
 *   BREVO_API_KEY     secret   Brevo API v3 key            (wrangler secret put BREVO_API_KEY)
 *   LEAD_RECIPIENTS   var      comma-separated inboxes that receive every enquiry
 *   SENDER_EMAIL      var      a sender verified in Brevo (Senders, domains and dedicated IPs)
 *   SENDER_NAME       var      display name for the sender
 *   ALLOWED_ORIGINS   var      comma-separated site origins allowed to post, e.g. https://twenty4x.com
 *   DB                D1       optional; every lead is saved here (schema.sql)
 *   ADMIN_PASSWORD    secret   password for the lead list at GET /leads and /leads.csv (any username)
 *
 * Request:  POST JSON, the payload built by the website (source 'twenty4x-bridge-lead-form', version 3)
 * Response: 200 {ok:true, messageId} only when Brevo accepted the email; otherwise 4xx/5xx {ok:false, error}
 */
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const MAX_BODY = 20000;
const PERSONAL = /@(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|proton|protonmail|aol|rediffmail|ymail)\./i;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => String(s ?? '').trim().slice(0, n);
const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);

function cors(origin, env) {
  const allowed = list(env.ALLOWED_ORIGINS);
  const ok = origin && (allowed.includes(origin) || allowed.includes('*'));
  return ok
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
    : { Vary: 'Origin' };
}
const json = (status, body, headers) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

/* validate and normalise the website payload; never trust it */
export function readLead(p) {
  if (!p || typeof p !== 'object') return { error: 'invalid_payload' };
  if (p.hp) return { spam: true };                                   /* honeypot filled: a bot */
  const c = p.contact || {};
  const lead = {
    name: clip(c.name, 120), email: clip(c.email, 200), company: clip(c.company, 160), role: clip(c.role, 80), note: clip(c.note, 1000),
    size: clip(p.fleet?.size, 20), types: (Array.isArray(p.fleet?.vesselTypes) ? p.fleet.vesselTypes : []).slice(0, 10).map((t) => clip(t, 40)),
    priorities: (Array.isArray(p.priorities) ? p.priorities : []).slice(0, 12).map((x) => ({ priority: clip(x?.priority, 80), modules: (Array.isArray(x?.suggestedModules) ? x.suggestedModules : []).slice(0, 6).map((m) => clip(m, 40)) })),
    modules: (Array.isArray(p.suggestedModules) ? p.suggestedModules : []).slice(0, 10).map((m) => clip(m, 40)),
    attribution: Object.fromEntries(Object.entries(p.attribution || {}).slice(0, 8).map(([k, v]) => [clip(k, 30), clip(v, 300)])),
    seconds: Number.isFinite(p.journey?.secondsToComplete) ? p.journey.secondsToComplete : null,
    submittedAt: clip(p.submittedAt, 40),
  };
  if (!lead.name) return { error: 'name_required' };
  if (!lead.company) return { error: 'company_required' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lead.email)) return { error: 'email_invalid' };
  return { lead };
}

export function buildEmail(l) {
  const subject = `New demo request: ${l.company}${l.size ? ` · ${l.size} vessels` : ''}`;
  const row = (k, v) => (v ? `<tr><td style="padding:6px 14px 6px 0;color:#5a6a80;font:600 12px/1.4 Arial;text-transform:uppercase;letter-spacing:.06em;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;color:#0b1d36;font:15px/1.5 Arial">${v}</td></tr>` : '');
  const pri = l.priorities.length ? `<ul style="margin:0;padding-left:18px">${l.priorities.map((x) => `<li>${esc(x.priority)}${x.modules.length ? ` <span style="color:#5a6a80">(suggested: ${esc(x.modules.join(', '))})</span>` : ''}</li>`).join('')}</ul>` : '';
  const attr = Object.entries(l.attribution).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join('<br>');
  const html = `<!doctype html><html><body style="margin:0;background:#eef3f8;padding:24px">
<table role="presentation" style="max-width:620px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #d6e1ec" cellpadding="0" cellspacing="0"><tr><td style="padding:24px 28px">
<p style="margin:0 0 4px;font:600 12px Arial;letter-spacing:.12em;text-transform:uppercase;color:#11639f">Twenty4x website · demo request</p>
<h1 style="margin:0 0 16px;font:600 22px/1.3 Arial;color:#0b1d36">${esc(l.name)} at ${esc(l.company)}</h1>
<table role="presentation" cellpadding="0" cellspacing="0">
${row('Name', esc(l.name))}${row('Work email', `<a href="mailto:${esc(l.email)}" style="color:#11639f">${esc(l.email)}</a>${PERSONAL.test(l.email) ? ' <span style="color:#9a6412">(personal address)</span>' : ''}`)}
${row('Company', esc(l.company))}${row('Role', esc(l.role))}
${row('Fleet size', l.size ? esc(l.size) + ' vessels' : 'Not given')}${row('Vessel types', esc(l.types.join(', ')))}
${row('Priorities', pri || 'Skipped')}${row('Suggested for demo', esc(l.modules.join(', ')))}
${row('Note', esc(l.note).replace(/\n/g, '<br>'))}
</table>
<p style="margin:18px 0 0;font:12.5px/1.5 Arial;color:#5a6a80">Suggestions are generated from the visitor's answers and are not a confirmed fit. Reply to this email to answer ${esc(l.name.split(' ')[0])} directly.</p>
${attr || l.seconds != null ? `<p style="margin:14px 0 0;font:12px/1.5 Arial;color:#7a8798">${attr}${attr && l.seconds != null ? '<br>' : ''}${l.seconds != null ? `Time to complete: ${esc(l.seconds)} s` : ''}${l.submittedAt ? `<br>Submitted: ${esc(l.submittedAt)}` : ''}</p>` : ''}
</td></tr></table></body></html>`;
  const text = [
    'Twenty4x website: demo request', '',
    `Name: ${l.name}`, `Work email: ${l.email}`, `Company: ${l.company}`, l.role && `Role: ${l.role}`,
    `Fleet size: ${l.size ? l.size + ' vessels' : 'Not given'}`, l.types.length && `Vessel types: ${l.types.join(', ')}`,
    l.priorities.length ? 'Priorities:\n' + l.priorities.map((x) => ` - ${x.priority}`).join('\n') : 'Priorities: skipped',
    l.modules.length && `Suggested for demo: ${l.modules.join(', ')}`, l.note && `\nNote: ${l.note}`,
    '', 'Suggestions are generated from the visitor\'s answers and are not a confirmed fit.',
  ].filter(Boolean).join('\n');
  return { subject, html, text };
}

/* ---------- lead storage (D1). Failures are logged and never block the email. ---------- */
async function saveLead(env, l, origin) {
  if (!env.DB) return null;
  try {
    const r = await env.DB.prepare(
      `INSERT INTO leads (name,email,company,role,note,fleet_size,vessel_types,priorities,modules,attribution,seconds,origin)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(l.name, l.email, l.company, l.role, l.note, l.size, l.types.join(', '),
      l.priorities.map((x) => x.priority).join('; '), l.modules.join(', '),
      JSON.stringify(l.attribution), l.seconds, origin).run();
    return r.meta?.last_row_id ?? null;
  } catch (e) { console.log('db_save_error', String(e)); return null; }
}
async function setStatus(env, id, status) {
  if (!env.DB || id == null) return;
  try { await env.DB.prepare('UPDATE leads SET email_status=? WHERE id=?').bind(status, id).run(); }
  catch (e) { console.log('db_status_error', String(e)); }
}

/* ---------- admin view: browser login prompt, any username + ADMIN_PASSWORD ---------- */
async function same(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  return crypto.subtle.timingSafeEqual(x, y);
}
async function authorized(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const m = /^Basic (.+)$/.exec(request.headers.get('Authorization') || '');
  if (!m) return false;
  let decoded = ''; try { decoded = atob(m[1]); } catch { return false; }
  return same(decoded.slice(decoded.indexOf(':') + 1), env.ADMIN_PASSWORD);
}
const COLS = ['id', 'created_at', 'name', 'email', 'company', 'role', 'fleet_size', 'vessel_types', 'priorities', 'modules', 'note', 'origin', 'email_status', 'attribution'];
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };

async function adminView(request, env, url) {
  if (!(await authorized(request, env))) {
    return new Response(env.ADMIN_PASSWORD ? 'Login required' : 'Set the ADMIN_PASSWORD secret first', {
      status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Twenty4x leads", charset="UTF-8"', 'Cache-Control': 'no-store' },
    });
  }
  if (!env.DB) return new Response('No database bound (DB)', { status: 500 });
  const { results = [] } = await env.DB.prepare(`SELECT ${COLS.join(',')} FROM leads ORDER BY id DESC LIMIT 5000`).all();
  const noStore = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

  if (url.pathname === '/leads.csv') {
    const body = [COLS.join(','), ...results.map((r) => COLS.map((c) => csvCell(r[c])).join(','))].join('\r\n');
    return new Response('﻿' + body, { headers: { ...noStore, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="twenty4x-leads-${new Date().toISOString().slice(0, 10)}.csv"` } });
  }
  const badge = (s) => `<span class="b ${esc(s)}">${esc(s)}</span>`;
  const rows = results.map((r) => `<tr>
<td class="n">${esc(r.id)}</td><td class="t">${esc(r.created_at)} UTC</td>
<td><b>${esc(r.name)}</b><br><a href="mailto:${esc(r.email)}">${esc(r.email)}</a>${PERSONAL.test(r.email || '') ? ' <i>personal</i>' : ''}</td>
<td>${esc(r.company)}<br><small>${esc(r.role)}</small></td>
<td>${esc(r.fleet_size)}<br><small>${esc(r.vessel_types)}</small></td>
<td><small>${esc(r.priorities)}</small></td><td><small>${esc(r.note)}</small></td>
<td>${badge(r.email_status)}<br><small>${esc(r.origin)}</small></td></tr>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Twenty4x leads</title><style>
body{margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,Arial;background:#eef3f8;color:#0b1d36}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:20px 16px}
h1{margin:0;font-size:20px}a{color:#11639f}.btn{background:#11639f;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none;font-weight:600}
.wrap{overflow-x:auto;margin:0 16px 24px;background:#fff;border:1px solid #d6e1ec;border-radius:12px}
table{border-collapse:collapse;width:100%;min-width:900px}th,td{padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid #e6edf4}
th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#5a6a80;background:#f6f9fc;position:sticky;top:0}
small{color:#5a6a80}i{color:#9a6412;font-style:normal;font-size:12px}.n,.t{white-space:nowrap;color:#5a6a80}
.b{display:inline-block;padding:2px 8px;border-radius:99px;font-size:12px;font-weight:600;background:#e6edf4}
.b.sent{background:#dcf3e4;color:#17663a}.b.failed{background:#fde2e1;color:#a32020}.b.pending{background:#fff1d6;color:#8a5a00}
.empty{padding:40px;text-align:center;color:#5a6a80}</style></head><body>
<header><h1>Website leads <small>(${results.length})</small></h1><span><a href="/links">Client links</a> &nbsp; <a href="/visits">Link visits</a> &nbsp; <a class="btn" href="/leads.csv">Download CSV</a></span></header>
<div class="wrap">${results.length ? `<table><thead><tr><th>#</th><th>Received</th><th>Contact</th><th>Company</th><th>Fleet</th><th>Priorities</th><th>Note</th><th>Email</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">No leads yet.</div>'}</div>
</body></html>`;
  return new Response(html, { headers: { ...noStore, 'Content-Type': 'text/html; charset=utf-8' } });
}

/* =====================================================================
   TRACKED-LINK VISITS
   The portal posts here (POST /visit) once per browser session when it is opened from a link
   with utm_* tags. We add IP, location (Cloudflare request.cf) and device, save it in D1 (visits)
   and email VISIT_RECIPIENTS (or LEAD_RECIPIENTS). A second 'leave' post records time on page.
   Location comes from the IP address: usually right to the city, not the street.
   ===================================================================== */
const VISIT_MAX_BODY = 4000;
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const BOT_UA = /bot\b|bot\/|crawl|spider|slurp|preview|facebookexternalhit|embedly|outbrain|pinterest|slack|discord|whatsapp|telegram|skype|vkshare|w3c_validator|headless|phantomjs|lighthouse|python|curl|wget|go-http|java\/|okhttp|axios|node-fetch|bingpreview|google-safety|safelinks|proofpoint|mimecast|barracuda|scanner/i;

/* browser, OS and device type from the user-agent text; good enough for a notification */
export function parseUA(ua, touch) {
  ua = String(ua || '');
  const v = (re) => { const m = re.exec(ua); return m ? m[1].split(/[._]/).slice(0, 2).join('.') : ''; };
  let browser = 'Unknown browser';
  if (/Edg(e|A|iOS)?\//.test(ua)) browser = 'Edge ' + v(/Edg(?:e|A|iOS)?\/([\d.]+)/);
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera ' + v(/OPR\/([\d.]+)/);
  else if (/SamsungBrowser\//.test(ua)) browser = 'Samsung Internet ' + v(/SamsungBrowser\/([\d.]+)/);
  else if (/FxiOS\//.test(ua)) browser = 'Firefox ' + v(/FxiOS\/([\d.]+)/);
  else if (/CriOS\//.test(ua)) browser = 'Chrome ' + v(/CriOS\/([\d.]+)/);
  else if (/Firefox\//.test(ua)) browser = 'Firefox ' + v(/Firefox\/([\d.]+)/);
  else if (/Chrome\//.test(ua)) browser = 'Chrome ' + v(/Chrome\/([\d.]+)/);
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = 'Safari ' + v(/Version\/([\d.]+)/);

  let os = 'Unknown OS';
  if (/iPhone/.test(ua)) os = 'iOS ' + v(/OS ([\d_]+)/);
  else if (/iPad/.test(ua)) os = 'iPadOS ' + v(/OS ([\d_]+)/);
  else if (/Android/.test(ua)) os = 'Android ' + v(/Android ([\d.]+)/);
  else if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
  else if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Mac OS X/.test(ua)) os = touch ? 'iPadOS' : 'macOS';     /* iPads report themselves as Macs */
  else if (/Linux/.test(ua)) os = 'Linux';

  let device = 'Desktop';
  if (/iPad|Tablet/.test(ua) || (os === 'iPadOS') || (/Android/.test(ua) && !/Mobile/.test(ua))) device = 'Tablet';
  else if (/Mobi|iPhone|Android/.test(ua)) device = 'Mobile';
  if (/iPhone/.test(ua)) device = 'iPhone';
  else if (os.startsWith('iPadOS')) device = 'iPad';
  else if (/Android/.test(ua)) { const m = /Android [\d.]+; (?:[a-z]{2}-[a-z]{2}; )?([^;)]+?)(?: Build|\))/i.exec(ua); if (m && m[1] !== 'K') device += ' (' + m[1].trim() + ')'; }
  return { browser: browser.trim(), os: os.trim(), device };
}

/* validate the portal's visit payload; never trust it */
export function readVisit(p) {
  if (!p || typeof p !== 'object') return { error: 'invalid_payload' };
  const type = p.type === 'leave' ? 'leave' : 'open';
  const sessionId = clip(p.sessionId, 64);
  if (!/^[\w-]{8,64}$/.test(sessionId)) return { error: 'session_required' };
  const seconds = Number.isFinite(p.seconds) ? Math.max(0, Math.min(86400, Math.round(p.seconds))) : null;
  if (type === 'leave') return { visit: { type, sessionId, seconds } };
  const utm = {}; UTM_KEYS.forEach((k) => { const x = clip(p.utm?.[k], 200); if (x) utm[k] = x; });
  if (!Object.keys(utm).length) return { error: 'utm_required' };   /* only tracked links are recorded */
  return {
    visit: {
      type, sessionId, seconds, utm,
      visitorId: /^[\w-]{8,64}$/.test(String(p.visitorId || '')) ? String(p.visitorId) : '',
      isReturn: p.isReturn ? 1 : 0, touch: !!p.touch,
      page: clip(p.page, 500), referrer: clip(p.referrer, 500),
      screen: clip(p.screen, 30), language: clip(p.language, 40), clientTz: clip(p.timezone, 60),
    },
  };
}

/* 'AE' -> 'United Arab Emirates'; falls back to the code */
export function fullCountry(code) {
  if (!code) return '';
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code; } catch { return code; }
}
/* city, region, postcode, country in full, e.g. 'Dubai, Dubai, 00000, United Arab Emirates' */
const fullPlace = (r) => [r.city, r.region, r.postal, r.countryName || fullCountry(r.country)].filter(Boolean).join(', ');

/* everything the request itself tells us: IP, location, network, device */
export function visitContext(request) {
  const cf = request.cf || {};
  const ua = request.headers.get('User-Agent') || '';
  const countryName = fullCountry(cf.country);
  return {
    ip: request.headers.get('CF-Connecting-IP') || '',
    city: cf.city || '', region: cf.region || '', country: cf.country || '', countryName,
    postal: cf.postalCode || '', lat: cf.latitude || '', lon: cf.longitude || '', timezone: cf.timezone || '',
    org: cf.asOrganization || '', asn: cf.asn ?? null, ua,
  };
}

/* link: the client link row from /links (or null for a hand-made utm link); opens: how many times this link has now been opened */
export function buildVisitEmail(v, c, d, n, link = null, opens = 0) {
  const tag = link?.client || v.utm.utm_content || v.utm.utm_campaign || v.utm.utm_source || 'portal link';
  const loc = fullPlace(c);
  const place = [c.city, c.region && c.region !== c.city ? c.region : '', c.countryName].filter(Boolean).join(', ') || 'unknown location';
  const subject = `${tag} opened your link · ${place} · ${d.device}`;
  const map = c.lat && c.lon ? `https://www.google.com/maps?q=${encodeURIComponent(c.lat + ',' + c.lon)}` : '';
  const visitNo = n > 1 ? `Returning visitor (visit ${n} from this browser)` : v.isReturn ? 'Returning visitor' : 'First visit';
  const opened = opens > 1 ? `Opened ${opens} times so far (counting each new session)` : opens === 1 ? 'First time this link was opened' : '';
  const row = (k, val) => (val ? `<tr><td style="padding:6px 14px 6px 0;color:#5a6a80;font:600 12px/1.4 Arial;text-transform:uppercase;letter-spacing:.06em;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;color:#0b1d36;font:15px/1.5 Arial">${val}</td></tr>` : '');
  const html = `<!doctype html><html><body style="margin:0;background:#eef3f8;padding:24px">
<table role="presentation" style="max-width:620px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #d6e1ec" cellpadding="0" cellspacing="0"><tr><td style="padding:24px 28px">
<p style="margin:0 0 4px;font:600 12px Arial;letter-spacing:.12em;text-transform:uppercase;color:#11639f">Twenty4x portal · tracked link opened</p>
<h1 style="margin:0 0 16px;font:600 22px/1.3 Arial;color:#0b1d36">${esc(tag)} opened the portal</h1>
<table role="presentation" cellpadding="0" cellspacing="0">
${row('Client', esc(link?.client))}${row('Company', esc(link?.company))}
${row('Client email', link?.email ? `<a href="mailto:${esc(link.email)}" style="color:#11639f">${esc(link.email)}</a>` : '')}
${row('Link', esc(opened))}
${row('Link code', esc(v.utm.utm_content))}${row('Campaign', esc(v.utm.utm_campaign))}
${link ? '' : row('Source / medium', esc([v.utm.utm_source, v.utm.utm_medium].filter(Boolean).join(' / ')))}${row('Term', esc(v.utm.utm_term))}
${row('Visit', esc(visitNo))}
${row('Location', esc(loc || 'Unknown'))}
${row('Map', map ? `<a href="${esc(map)}" style="color:#11639f">${esc(c.lat)}, ${esc(c.lon)}</a> <span style="color:#5a6a80">(approximate)</span>` : '')}
${row('Network', esc([c.org, c.asn ? 'AS' + c.asn : ''].filter(Boolean).join(' · ')))}
${row('IP address', esc(c.ip))}
${row('Device', esc(d.device))}${row('Browser', esc(d.browser))}${row('System', esc(d.os))}
${row('Screen', esc(v.screen))}${row('Language', esc(v.language))}
${row('Time zone', esc([c.timezone, v.clientTz && v.clientTz !== c.timezone ? `device says ${v.clientTz}` : ''].filter(Boolean).join(' · ')))}
${row('Came from', esc(v.referrer))}${row('Page', esc(v.page))}
</table>
<p style="margin:18px 0 0;font:12.5px/1.5 Arial;color:#5a6a80">Location and network are estimated from the IP address and are usually right to the city. VPNs and mobile networks can show a different place. Anyone the link was forwarded to appears under the same tag.</p>
</td></tr></table></body></html>`;
  const text = [
    'Twenty4x portal: tracked link opened', '',
    link ? `Client: ${link.client}` : `Link tag: ${tag}`, link?.company && `Company: ${link.company}`, link?.email && `Client email: ${link.email}`,
    opened, `Link code: ${v.utm.utm_content || ''}`, v.utm.utm_campaign && `Campaign: ${v.utm.utm_campaign}`,
    !link && `Source / medium: ${[v.utm.utm_source, v.utm.utm_medium].filter(Boolean).join(' / ')}`, visitNo,
    `Location: ${loc || 'Unknown'}`, map && `Map: ${map}`, c.org && `Network: ${c.org}${c.asn ? ' AS' + c.asn : ''}`,
    `IP: ${c.ip}`, `Device: ${d.device} · ${d.browser} · ${d.os}`, v.screen && `Screen: ${v.screen}`,
    v.referrer && `Came from: ${v.referrer}`, `Page: ${v.page}`,
  ].filter(Boolean).join('\n');
  return { subject, html, text };
}

async function handleVisit(request, env, h, origin) {
  const ok = (extra) => json(200, { ok: true, ...extra }, h);
  const raw = await request.text();
  if (raw.length > VISIT_MAX_BODY) return json(413, { ok: false, error: 'too_large' }, h);
  let p; try { p = JSON.parse(raw); } catch { return json(400, { ok: false, error: 'invalid_json' }, h); }
  const r = readVisit(p);
  if (r.error) return json(422, { ok: false, error: r.error }, h);
  const v = r.visit;

  if (v.type === 'leave') {                                          /* time on page; no email */
    if (env.DB) {
      try {
        await env.DB.prepare('UPDATE visits SET seconds_on_page = MAX(COALESCE(seconds_on_page,0), ?) WHERE session_id = ?')
          .bind(v.seconds ?? 0, v.sessionId).run();
      } catch (e) { console.log('db_visit_leave_error', String(e)); }
    }
    return ok();
  }

  const c = visitContext(request);
  if (!c.ua || BOT_UA.test(c.ua)) return ok({ ignored: 'bot' });    /* link previewers and scanners */
  const d = parseUA(c.ua, v.touch);

  /* Each new browser session = one visit = one email. Reloading the same tab keeps its session and is not counted again. */
  let visitId = null, visitCount = 1, link = null, opens = 0;
  if (env.DB) {
    try {
      if (await env.DB.prepare('SELECT id FROM visits WHERE session_id = ? LIMIT 1').bind(v.sessionId).first()) return ok({ duplicate: true });
      if (v.visitorId) {
        const prev = await env.DB.prepare('SELECT COUNT(*) AS n FROM visits WHERE visitor_id = ?').bind(v.visitorId).first();
        visitCount = (prev?.n || 0) + 1;
      }
      if (v.utm.utm_content) {
        try { link = await env.DB.prepare('SELECT client, company, email, campaign FROM links WHERE code = ?').bind(v.utm.utm_content).first(); } catch { link = null; }
        const o = await env.DB.prepare('SELECT COUNT(*) AS n FROM visits WHERE utm_content = ?').bind(v.utm.utm_content).first();
        opens = (o?.n || 0) + 1;
      }
      const res = await env.DB.prepare(
        `INSERT INTO visits (visitor_id,session_id,is_return,utm_source,utm_medium,utm_campaign,utm_term,utm_content,page,referrer,
          ip,city,region,country,postal,lat,lon,timezone,network_org,asn,browser,os,device,screen,language,client_timezone,user_agent,seconds_on_page,origin)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(v.visitorId, v.sessionId, v.isReturn || visitCount > 1 ? 1 : 0,
        v.utm.utm_source || '', v.utm.utm_medium || '', v.utm.utm_campaign || '', v.utm.utm_term || '', v.utm.utm_content || '',
        v.page, v.referrer, c.ip, c.city, c.region, c.country, c.postal, String(c.lat), String(c.lon), c.timezone, c.org, c.asn,
        d.browser, d.os, d.device, v.screen, v.language, v.clientTz, c.ua.slice(0, 400), v.seconds, origin).run();
      visitId = res.meta?.last_row_id ?? null;
    } catch (e) { console.log('db_visit_save_error', String(e)); }
  }
  const setVisitStatus = async (s) => {
    if (!env.DB || visitId == null) return;
    try { await env.DB.prepare('UPDATE visits SET email_status=? WHERE id=?').bind(s, visitId).run(); } catch (e) { console.log('db_visit_status_error', String(e)); }
  };

  const to = list(env.VISIT_RECIPIENTS).length ? list(env.VISIT_RECIPIENTS) : list(env.LEAD_RECIPIENTS);
  if (String(env.VISIT_EMAILS || 'on').toLowerCase() === 'off') { await setVisitStatus('off'); return ok({ emailed: false }); }
  if (!env.BREVO_API_KEY || !env.SENDER_EMAIL || !to.length) { await setVisitStatus('failed'); return ok({ emailed: false }); }

  const { subject, html, text } = buildVisitEmail(v, c, d, visitCount, link, opens);
  try {
    const res = await fetch(BREVO_URL, {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: env.SENDER_EMAIL, name: env.SENDER_NAME || 'Twenty4x Website' },
        to: to.map((email) => ({ email })), subject, htmlContent: html, textContent: text, tags: ['website-visit'],
      }),
    });
    if (res.status === 201 || res.ok) { await setVisitStatus('sent'); return ok({ emailed: true }); }
    console.log('brevo_visit_error', res.status, (await res.text().catch(() => '')).slice(0, 500));
  } catch (e) { console.log('brevo_visit_error', String(e)); }
  await setVisitStatus('failed');
  return ok({ emailed: false });                                      /* the visitor never sees an error */
}

const VCOLS = ['id', 'created_at', 'utm_content', 'utm_campaign', 'utm_source', 'utm_medium', 'utm_term', 'visitor_id', 'is_return', 'ip', 'city', 'region', 'postal', 'country', 'lat', 'lon', 'timezone', 'network_org', 'asn', 'device', 'browser', 'os', 'screen', 'language', 'client_timezone', 'seconds_on_page', 'referrer', 'page', 'user_agent', 'origin', 'email_status'];

async function visitsView(request, env, url) {
  if (!(await authorized(request, env))) {
    return new Response(env.ADMIN_PASSWORD ? 'Login required' : 'Set the ADMIN_PASSWORD secret first', {
      status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Twenty4x leads", charset="UTF-8"', 'Cache-Control': 'no-store' },
    });
  }
  if (!env.DB) return new Response('No database bound (DB)', { status: 500 });
  const only = clip(url.searchParams.get('link'), 80);                /* /visits?link=<code>: one client's visits */
  const sel = `SELECT ${VCOLS.map((k) => 'v.' + k).join(',')}, l.client, l.company FROM visits v LEFT JOIN links l ON l.code = v.utm_content`;
  let results = [];
  try {
    ({ results = [] } = await (only ? env.DB.prepare(`${sel} WHERE v.utm_content = ? ORDER BY v.id DESC LIMIT 5000`).bind(only) : env.DB.prepare(`${sel} ORDER BY v.id DESC LIMIT 5000`)).all());
  } catch {                                                           /* links table not created yet: plain list */
    ({ results = [] } = await env.DB.prepare(`SELECT ${VCOLS.join(',')} FROM visits ORDER BY id DESC LIMIT 5000`).all());
  }
  results.forEach((r) => { r.country_name = fullCountry(r.country); });
  const noStore = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
  if (url.pathname === '/visits.csv') {
    const cols = ['id', 'created_at', 'client', 'company', ...VCOLS.slice(2, 14), 'country_name', ...VCOLS.slice(14)];
    const body = [cols.join(','), ...results.map((r) => cols.map((k) => csvCell(r[k])).join(','))].join('\r\n');
    return new Response('﻿' + body, { headers: { ...noStore, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="twenty4x-visits-${new Date().toISOString().slice(0, 10)}.csv"` } });
  }
  const dur = (s) => (s == null ? '' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);
  const rows = results.map((r) => {
    const map = r.lat && r.lon ? ` <a href="https://www.google.com/maps?q=${encodeURIComponent(r.lat + ',' + r.lon)}" target="_blank" rel="noopener">map</a>` : '';
    return `<tr>
<td class="n">${esc(r.id)}</td><td class="t">${esc(r.created_at)} UTC</td>
<td><b>${esc(r.client || r.utm_content || '(no tag)')}</b>${r.company ? `<br>${esc(r.company)}` : ''}<br><small>${esc([r.client ? r.utm_content : '', r.utm_campaign, r.client ? '' : r.utm_source, r.client ? '' : r.utm_medium].filter(Boolean).join(' · '))}</small></td>
<td>${esc(fullPlace({ ...r, countryName: r.country_name }))}${map}<br><small>${esc(r.timezone)}</small></td>
<td>${esc(r.network_org)}<br><small>${esc(r.ip)}</small></td>
<td>${esc(r.device)}<br><small>${esc(r.browser)} · ${esc(r.os)}</small></td>
<td>${r.is_return ? 'Returning' : 'First'}<br><small>${esc(dur(r.seconds_on_page))}</small></td>
<td><span class="b ${esc(r.email_status)}">${esc(r.email_status)}</span></td></tr>`;
  }).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Twenty4x link visits</title><style>
body{margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,Arial;background:#eef3f8;color:#0b1d36}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:20px 16px}
h1{margin:0;font-size:20px}a{color:#11639f}.btn{background:#11639f;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none;font-weight:600}
.wrap{overflow-x:auto;margin:0 16px 24px;background:#fff;border:1px solid #d6e1ec;border-radius:12px}
table{border-collapse:collapse;width:100%;min-width:900px}th,td{padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid #e6edf4}
th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#5a6a80;background:#f6f9fc;position:sticky;top:0}
small{color:#5a6a80}.n,.t{white-space:nowrap;color:#5a6a80}
.b{display:inline-block;padding:2px 8px;border-radius:99px;font-size:12px;font-weight:600;background:#e6edf4}
.b.sent{background:#dcf3e4;color:#17663a}.b.failed{background:#fde2e1;color:#a32020}.b.pending{background:#fff1d6;color:#8a5a00}
.empty{padding:40px;text-align:center;color:#5a6a80}</style></head><body>
<header><h1>Link visits <small>(${results.length})</small>${only ? ` <small>for ${esc(results[0]?.client || only)} · <a href="/visits">show all</a></small>` : ''}</h1><span><a href="/links">Client links</a> &nbsp; <a href="/leads">Leads</a> &nbsp; <a class="btn" href="/visits.csv${only ? '?link=' + encodeURIComponent(only) : ''}">Download CSV</a></span></header>
<div class="wrap">${results.length ? `<table><thead><tr><th>#</th><th>Opened</th><th>Link</th><th>Location</th><th>Network / IP</th><th>Device</th><th>Visit</th><th>Email</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">No link visits yet.</div>'}</div>
</body></html>`;
  return new Response(html, { headers: { ...noStore, 'Content-Type': 'text/html; charset=utf-8' } });
}

/* =====================================================================
   CLIENT LINKS (GET/POST /links, password protected)
   Type a client name, get a unique portal link to copy and share. The link is a normal portal URL
   whose utm_content is the link's code, so the portal needs no change: when it is opened, the visit
   is matched back to the client and the email names them.
   ===================================================================== */
const portals = (env) => (list(env.PORTAL_URLS).length ? list(env.PORTAL_URLS) : ['https://deck.twenty4x.net/']);

/* 'Acme Shipping Ltd.' -> 'acme-shipping-ltd-k3x9q' (readable + random, so it cannot be guessed) */
export function linkCode(client) {
  const slug = String(client).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '') || 'client';
  const r = crypto.getRandomValues(new Uint8Array(5));
  return slug + '-' + Array.from(r, (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
}
export function linkUrl(portal, code, campaign) {
  const u = new URL(portal);
  u.searchParams.set('utm_source', 'twenty4x');
  u.searchParams.set('utm_medium', 'client-link');
  u.searchParams.set('utm_campaign', campaign || 'client-link');
  u.searchParams.set('utm_content', code);
  return u.toString();
}

async function linksView(request, env, url) {
  if (!(await authorized(request, env))) {
    return new Response(env.ADMIN_PASSWORD ? 'Login required' : 'Set the ADMIN_PASSWORD secret first', {
      status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Twenty4x leads", charset="UTF-8"', 'Cache-Control': 'no-store' },
    });
  }
  if (!env.DB) return new Response('No database bound (DB)', { status: 500 });
  const noStore = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
  const back = (q) => new Response(null, { status: 303, headers: { ...noStore, Location: '/links' + (q ? '?' + q : '') } });

  if (request.method === 'POST') {
    /* only this page may post here (stops other websites using your logged-in browser) */
    if (request.headers.get('Origin') !== url.origin) return new Response('Forbidden', { status: 403 });
    const f = await request.formData();
    if (f.get('action') === 'delete') {
      await env.DB.prepare('DELETE FROM links WHERE id = ?').bind(Number(f.get('id')) || 0).run();
      return back('removed=1');
    }
    const client = clip(f.get('client'), 120);
    if (!client) return back('error=name');
    const company = clip(f.get('company'), 160), email = clip(f.get('email'), 200), note = clip(f.get('note'), 500);
    const campaign = clip(f.get('campaign'), 60).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const all = portals(env);
    const portal = all.includes(String(f.get('portal'))) ? String(f.get('portal')) : all[0];
    for (let i = 0; i < 3; i++) {                                     /* retry on the (very unlikely) code clash */
      const code = linkCode(company && !client.toLowerCase().includes(company.toLowerCase()) ? `${client} ${company}` : client);
      try {
        await env.DB.prepare('INSERT INTO links (code, client, company, email, note, campaign, url) VALUES (?,?,?,?,?,?,?)')
          .bind(code, client, company, email, note, campaign, linkUrl(portal, code, campaign)).run();
        return back('created=' + encodeURIComponent(code));
      } catch (e) { if (!/UNIQUE/i.test(String(e))) throw e; }
    }
    return back('error=retry');
  }

  const { results = [] } = await env.DB.prepare(
    `SELECT l.*, COUNT(v.id) AS opens, MAX(v.id) AS last_id FROM links l LEFT JOIN visits v ON v.utm_content = l.code
     GROUP BY l.id ORDER BY l.id DESC LIMIT 2000`).all();
  const lastIds = results.map((r) => r.last_id).filter(Boolean);
  const last = {};
  if (lastIds.length) {
    const { results: lv = [] } = await env.DB.prepare(
      `SELECT id, created_at, city, region, postal, country, device FROM visits WHERE id IN (${lastIds.map(() => '?').join(',')})`).bind(...lastIds).all();
    lv.forEach((x) => { last[x.id] = x; });
  }
  const created = url.searchParams.get('created') || '';
  const msg = url.searchParams.get('error') === 'name' ? '<p class="msg err">Enter the client name.</p>'
    : url.searchParams.get('error') ? '<p class="msg err">Could not create the link. Try again.</p>'
      : url.searchParams.get('removed') ? '<p class="msg">Link removed. Its past visits are kept on the visits page.</p>'
        : created ? '<p class="msg ok">Link created. Copy it below and send it to the client.</p>' : '';
  const all = portals(env);
  const rows = results.map((r) => {
    const lv = last[r.last_id];
    const seen = lv ? `${esc(lv.created_at)} UTC<br><small>${esc(fullPlace(lv))} · ${esc(lv.device)}</small>` : '<small>Not opened yet</small>';
    return `<tr${r.code === created ? ' class="new"' : ''}>
<td><b>${esc(r.client)}</b>${r.company ? `<br>${esc(r.company)}` : ''}${r.email ? `<br><small>${esc(r.email)}</small>` : ''}${r.note ? `<br><small>${esc(r.note)}</small>` : ''}</td>
<td class="lk"><input readonly value="${esc(r.url)}" aria-label="Link for ${esc(r.client)}"><button type="button" class="btn copy">Copy</button><br><small>${esc(r.campaign || 'no campaign')} · made ${esc(r.created_at.slice(0, 10))}</small></td>
<td class="c"><a href="/visits?link=${encodeURIComponent(r.code)}"><b>${esc(r.opens)}</b></a></td>
<td>${seen}</td>
<td><form method="post" data-name="${esc(r.client)}" onsubmit="return confirm('Remove the link for ' + this.dataset.name + '? Opens after this are still recorded, but without the client name.')"><input type="hidden" name="action" value="delete"><input type="hidden" name="id" value="${esc(r.id)}"><button class="x" title="Remove">Remove</button></form></td></tr>`;
  }).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Twenty4x client links</title><style>
body{margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,Arial;background:#eef3f8;color:#0b1d36}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:20px 16px}
h1{margin:0;font-size:20px}h2{margin:0 0 12px;font-size:16px}a{color:#11639f}
.btn{background:#11639f;color:#fff;padding:8px 14px;border-radius:8px;border:0;text-decoration:none;font:600 14px system-ui,Arial;cursor:pointer}
.card{margin:0 16px 16px;background:#fff;border:1px solid #d6e1ec;border-radius:12px;padding:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;align-items:end}
label{display:block;font-size:12px;font-weight:600;color:#5a6a80}label input,label select{display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:9px 10px;border:1px solid #c4d2e0;border-radius:8px;font:14px system-ui,Arial;background:#fff;color:#0b1d36}
.wrap{overflow-x:auto;margin:0 16px 24px;background:#fff;border:1px solid #d6e1ec;border-radius:12px}
table{border-collapse:collapse;width:100%;min-width:900px}th,td{padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid #e6edf4}
th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#5a6a80;background:#f6f9fc}
small{color:#5a6a80}.c{text-align:center;font-size:16px}tr.new{background:#f0f8ff}
.lk input{width:min(420px,60vw);padding:7px 8px;border:1px solid #c4d2e0;border-radius:6px;font:12.5px ui-monospace,Menlo,monospace;color:#0b1d36;background:#f6f9fc}
.lk .btn{padding:6px 12px;margin-left:6px}.copy.done{background:#17663a}
.x{background:none;border:1px solid #e3c4c4;color:#a32020;border-radius:6px;padding:4px 10px;cursor:pointer;font:13px system-ui,Arial}
.msg{margin:0 16px 12px;padding:10px 14px;border-radius:8px;background:#e6edf4}.msg.ok{background:#dcf3e4;color:#17663a}.msg.err{background:#fde2e1;color:#a32020}
.empty{padding:40px;text-align:center;color:#5a6a80}</style></head><body>
<header><h1>Client links <small>(${results.length})</small></h1><span><a href="/visits">Link visits</a> &nbsp; <a href="/leads">Leads</a></span></header>
${msg}
<form class="card" method="post"><h2>Create a link for a client</h2><div class="grid">
<label>Client name *<input name="client" required maxlength="120" placeholder="John Smith" autofocus></label>
<label>Company<input name="company" maxlength="160" placeholder="Acme Shipping"></label>
<label>Client email<input name="email" type="email" maxlength="200" placeholder="john@acme.com"></label>
<label>Campaign<input name="campaign" maxlength="60" placeholder="nov-fleet"></label>
${all.length > 1 ? `<label>Portal<select name="portal">${all.map((p) => `<option>${esc(p)}</option>`).join('')}</select></label>` : `<input type="hidden" name="portal" value="${esc(all[0])}">`}
<label>Note (only you see this)<input name="note" maxlength="500" placeholder="Met at SMM Hamburg"></label>
<button class="btn">Create link</button></div></form>
<div class="wrap">${results.length ? `<table><thead><tr><th>Client</th><th>Link to share</th><th>Opens</th><th>Last opened</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">No client links yet. Create the first one above.</div>'}</div>
<script>
document.querySelectorAll('.copy').forEach(function (b) {
  b.addEventListener('click', function () {
    var i = b.previousElementSibling; i.select();
    var done = function () { b.textContent = 'Copied'; b.classList.add('done'); setTimeout(function () { b.textContent = 'Copy'; b.classList.remove('done'); }, 1800); };
    if (navigator.clipboard) navigator.clipboard.writeText(i.value).then(done, function () { document.execCommand('copy'); done(); });
    else { document.execCommand('copy'); done(); }
  });
});
var n = document.querySelector('tr.new'); if (n) n.scrollIntoView({ block: 'center' });
</script>
</body></html>`;
  return new Response(html, { headers: { ...noStore, 'Content-Type': 'text/html; charset=utf-8' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/links' && (request.method === 'GET' || request.method === 'POST')) return linksView(request, env, url);
    if (request.method === 'GET' && (url.pathname === '/leads' || url.pathname === '/leads.csv')) return adminView(request, env, url);
    if (request.method === 'GET' && (url.pathname === '/visits' || url.pathname === '/visits.csv')) return visitsView(request, env, url);
    if (url.pathname === '/visit' && request.method === 'POST') {
      const vo = request.headers.get('Origin') || '', vh = cors(vo, env);
      if (!vh['Access-Control-Allow-Origin']) return json(403, { ok: false, error: 'origin_not_allowed' }, vh);
      return handleVisit(request, env, vh, vo);
    }
    const origin = request.headers.get('Origin') || '';
    const h = cors(origin, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: h['Access-Control-Allow-Origin'] ? 204 : 403, headers: h });
    if (request.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' }, h);
    if (!h['Access-Control-Allow-Origin']) return json(403, { ok: false, error: 'origin_not_allowed' }, h);
    if (!env.BREVO_API_KEY || !env.SENDER_EMAIL || !list(env.LEAD_RECIPIENTS).length) return json(500, { ok: false, error: 'relay_not_configured' }, h);

    const raw = await request.text();
    if (raw.length > MAX_BODY) return json(413, { ok: false, error: 'too_large' }, h);
    let p; try { p = JSON.parse(raw); } catch { return json(400, { ok: false, error: 'invalid_json' }, h); }
    const r = readLead(p);
    if (r.spam) return json(200, { ok: true }, h);                 /* look successful to bots, send nothing */
    if (r.error) return json(422, { ok: false, error: r.error }, h);

    const leadId = await saveLead(env, r.lead, origin);
    const { subject, html, text } = buildEmail(r.lead);
    const res = await fetch(BREVO_URL, {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: env.SENDER_EMAIL, name: env.SENDER_NAME || 'Twenty4x Website' },
        to: list(env.LEAD_RECIPIENTS).map((email) => ({ email })),
        replyTo: { email: r.lead.email, name: r.lead.name },
        subject, htmlContent: html, textContent: text, tags: ['website-lead'],
      }),
    });
    if (res.status === 201 || res.ok) {
      const b = await res.json().catch(() => ({}));
      await setStatus(env, leadId, 'sent');
      return json(200, { ok: true, messageId: b.messageId || null }, h);
    }
    const detail = await res.text().catch(() => '');
    console.log('brevo_error', res.status, detail.slice(0, 500));       /* visible in `wrangler tail`, never sent to the browser */
    await setStatus(env, leadId, 'failed');
    return json(502, { ok: false, error: 'email_failed' }, h);
  },
};
