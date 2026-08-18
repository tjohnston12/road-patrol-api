// api/_lib.js — shared plumbing for road-patrol-api.
//
// Airtable fetch, CORS, the SSO header identity check, and the live patroller
// list. Kept dependency-free and CommonJS like every other MRDC API repo.
//
// Identity note: the x-user-* / x-app-role headers come from the SSO session via
// htra-auth.js. They close the in-app path but are spoofable in a direct API
// call — signed tokens are the real fix (tracked in the README).

const PAT = process.env.AIRTABLE_PAT;

// Employees directory — the single source of truth for people across every app.
const EMP_BASE  = process.env.EMP_BASE  || 'appraSoUXoTbhroG6';
const EMP_TABLE = process.env.EMP_TABLE || 'tblUfWrGjHTHXszos';
const EF = {
  name:      'fldtLjh72SJV8Uyfb',
  email:     'fldBggHLMX7abWiSK',
  role:      'fldWRmtEbJ6tfyLX1',
  jobTitle:  'fldJkDrwa6kc0IJnA',
  appAccess: 'fldiArCcZx8uGtGl8',
  active:    'fldcHPqfxScpuUbZ6',
  depot:     'fldceGQ02MnpBu07U',
};

// Job titles that put someone on the road. Seeds the patroller picker so it is
// useful before "Patrol" has been granted in anyone's App Access.
const PATROL_TITLES = [
  'Patroller - Full Time', 'Winter Patroller', 'Supervisor / Operator',
  'Area Manager', 'Annual Inspector',
];

const arr = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
const sel = v => ((v && typeof v === 'object' ? v.name : v) || '');
// Only send a number when one was actually entered — '' must not become 0.
const num = v => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? undefined : Number(v));
const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

async function airtable(path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json.error?.message || json.error?.type || `Airtable ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return json;
}

function corsOrigin(req) {
  const o = req.headers.origin || '';
  if (/^https:\/\/([a-z0-9-]+\.)*mrdc-htra\.com$/i.test(o)) return o;
  return 'https://www.mrdc-htra.com';
}

// Sets the CORS headers and answers a preflight. Returns true if the request
// was a preflight and has already been ended by this call.
function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', corsOrigin(req));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-role, x-app-role, x-user-name, x-user-id');
  if (req.method === 'OPTIONS') { res.status(200).end(); return true; }
  return false;
}

const ADMIN_ROLES = ['Admin', 'Manager'];
const isAdmin = req =>
  ADMIN_ROLES.includes(String(req.headers['x-app-role'] || '')) ||
  ['Owner', 'Admin'].includes(String(req.headers['x-user-role'] || ''));
const callerName  = req => String(req.headers['x-user-name'] || '');
const parseBody   = req => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}));

// Every employee in the directory, shaped for the apps. Returns ALL of them —
// active and inactive — because callers need different slices:
//
//   Winter patrollers are SEASONAL. Out of season they are marked Inactive in
//   the directory, so an active-only filter would hide exactly the people the
//   winter roster needs. Callers that want a live roster decide for themselves
//   whether inactive counts (see patrol.js), rather than having that judgement
//   baked in here.
async function getEmployees() {
  try {
    const out = [];
    let offset;
    do {
      const qs = new URLSearchParams();
      qs.set('pageSize', '100');
      qs.set('returnFieldsByFieldId', 'true');
      ['name', 'email', 'role', 'jobTitle', 'appAccess', 'active', 'depot'].forEach(k => qs.append('fields[]', EF[k]));
      if (offset) qs.set('offset', offset);
      const page = await airtable(`${EMP_BASE}/${encodeURIComponent(EMP_TABLE)}?${qs}`);
      for (const rec of (page.records || [])) {
        const f = rec.fields || {};
        const name = f[EF.name];
        if (!name) continue;
        out.push({
          name,
          email:  f[EF.email] || '',
          depot:  sel(f[EF.depot]),
          role:   sel(f[EF.role]),
          titles: arr(f[EF.jobTitle]).map(sel),
          apps:   arr(f[EF.appAccess]).map(sel),
          active: sel(f[EF.active]) !== 'Inactive',
        });
      }
      offset = page.offset;
    } while (offset);
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch (_) { return []; }
}

// Active people who either hold a road-going job title, have Patrol in their
// App Access, or are an Owner. Falls back to every active employee if that
// yields nothing, so a picker is never empty on day one.
async function getPatrollers() {
  const all = await getEmployees();
  const active = all.filter(p => p.active);
  const patrol = active.filter(p =>
    p.titles.some(t => PATROL_TITLES.includes(t)) || p.apps.includes('Patrol') || p.role === 'Owner');
  return (patrol.length ? patrol : active).map(({ name, email, depot }) => ({ name, email, depot }));
}

// Append a base64 file to an attachment field via the Airtable content API.
async function uploadAttachment({ base, recordId, fieldId, filename, contentType, data }) {
  const r = await fetch(`https://content.airtable.com/v0/${base}/${encodeURIComponent(recordId)}/${fieldId}/uploadAttachment`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: contentType || 'application/octet-stream', file: data, filename: filename || 'upload' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.error?.message || `Upload failed (${r.status})`);
    e.status = r.status;
    throw e;
  }
  return j;
}

// Best-effort transactional email through Resend. Returns the list of addresses
// actually sent to, or [] when unconfigured/failed — never throws to the caller,
// because a mail outage must not block a patroller filing at the roadside.
// Send mail, and SAY WHY when nothing goes out.
//
// The plain sendMail() below returns just the recipient list, which means every
// failure looks identical to "nothing to send" at the call site. That cost us an
// afternoon on 2026-08-18 guessing at an empty API key from the outside. This
// version returns the reason too, so a caller can surface it instead of
// depending on the platform's log viewer.
async function sendMailDetailed({ to, subject, html, from }) {
  const key = process.env.RESEND_API_KEY;
  const recipients = (Array.isArray(to) ? to : String(to || '').split(','))
    .map(s => String(s).trim()).filter(Boolean);

  if (!key) return { sent: [], reason: 'RESEND_API_KEY is missing or empty in this deployment' };
  if (!recipients.length) {
    return { sent: [], reason: 'no usable recipients — check the PATROL_MAIL_* values for blanks or stray whitespace' };
  }
  const fromAddr = from || process.env.MVA_FROM || 'MRDC Road Patrol <noreply@mrdc-htra.com>';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromAddr, to: recipients, subject, html }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return { sent: [], reason: `Resend rejected it (HTTP ${r.status}) from=${fromAddr}: ${body.slice(0, 300)}` };
    }
    return { sent: recipients, reason: '' };
  } catch (e) {
    return { sent: [], reason: `could not reach Resend: ${e.message}` };
  }
}

async function sendMail(opts) {
  const r = await sendMailDetailed(opts);
  if (r.reason) console.error('sendMail:', r.reason);
  return r.sent;
}

// Append a base64 file to an attachment field via the Airtable content API.
async function uploadAttachment({ base, recordId, fieldId, filename, contentType, data }) {
  const r = await fetch(`https://content.airtable.com/v0/${base}/${encodeURIComponent(recordId)}/${fieldId}/uploadAttachment`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: contentType || 'application/octet-stream', file: data, filename: filename || 'upload' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.error?.message || `Upload failed (${r.status})`);
    e.status = r.status;
    throw e;
  }
  return j;
}

// Best-effort transactional email through Resend. Returns the list of addresses
// actually sent to, or [] when unconfigured/failed — never throws to the caller,
// because a mail outage must not block a patroller filing at the roadside.
async function sendMail({ to, subject, html, from }) {
  const key = process.env.RESEND_API_KEY;
  const recipients = (Array.isArray(to) ? to : String(to || '').split(','))
    .map(s => String(s).trim()).filter(Boolean);
  // Say WHY nothing was sent. A silent skip here is indistinguishable from a
  // successful send at the call site, which makes a misconfigured key look like
  // a working one — that cost us a debugging session on 2026-08-18.
  if (!key) { console.error('sendMail: RESEND_API_KEY is missing or empty — no email sent to', recipients.join(', ')); return []; }
  if (!recipients.length) { console.error('sendMail: no recipients resolved — no email sent'); return []; }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: from || process.env.MVA_FROM || 'MRDC Road Patrol <noreply@mrdc-htra.com>',
        to: recipients, subject, html,
      }),
    });
    if (!r.ok) { console.error('sendMail failed:', r.status, await r.text().catch(() => '')); return []; }
    return recipients;
  } catch (e) {
    console.error('sendMail error:', e.message);
    return [];
  }
}

module.exports = {
  PAT, EMP_BASE, EMP_TABLE, EF, PATROL_TITLES,
  arr, sel, num, esc,
  airtable, cors, corsOrigin, isAdmin, callerName, parseBody,
  getEmployees, getPatrollers, uploadAttachment, sendMail, sendMailDetailed,
};
