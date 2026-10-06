/*
 * api/_conditions.js — Winter Road Conditions: the shared rules.
 * ---------------------------------------------------------------------------
 * Troy, 2026-10-06, picking Phase 3 back up with winter nine days away: build the
 * Winter Road Conditions form first. It replaces the DeviceMagic "Winter Road
 * Conditions" form (export read 2026-09-02 — claude/road-patrol-phase-3-legacy-
 * recon.md §1) and serves OMM 601 Winter Control:
 *
 *   601.2.2(g) daily reports to the PMCC at 06:00, 10:00 and 14:00 — built from
 *              these observations by api/pmcc-report.js;
 *   601.2.2(h) report immediately on adverse conditions — a button the
 *              patroller presses (Troy: "let alert be a button that the
 *              patroller hits to alert other patrollers and managers"), NOT an
 *              automatic rule on the condition picked.
 *
 * Used by api/conditions.js and api/pmcc-report.js. Pure functions plus the
 * recipient and switch lookups; Airtable via _lib.airtable().
 */
'use strict';
const L = require('./_lib');

const BASE = process.env.AIRTABLE_BASE || 'app2m7rkP51kLLpbe';
const T_OBS = 'tblEIzL4ESYpnotMU';      // Road Conditions
const T_PMCC = 'tblwkE93OpsImJOxK';     // PMCC Reports
const T_SWITCH = 'tbltvyYslcnGUGndD';   // Patrol Notifications
const F = {
  obsId: 'fldZfroAEphcoBlVZ', observedAt: 'fldf7cZDZHN8Vj4a4', depot: 'fldJQMFCinVbjH6Ac', division: 'fldeAXf7zmttVpkPE',
  route: 'fldZIAyiTBph4XIxH', conditions: 'fldKtKnzrlqBee2f8', comments: 'fldn5uhw3fsCiy0Ac', patroller: 'fldLSZDQglSOuuMBW',
  submittedBy: 'fldaBjpCxPr4hzPzJ', submittedAt: 'fldYkHJqhR4dM8PcY', alertSent: 'fldMLqC46NvpiNucH',
  alertAt: 'fld21Q0AIyn33gkDW', alertTo: 'fldr3F7BSBI4vSQ4D',
};
const P = {
  report: 'fldjfdFiFcpmHrSoW', date: 'fld1DLXjkJlNkpeWP', slot: 'fldV34KObMi9YQMud', generatedAt: 'fldWYmRUYxlvPgPy2',
  status: 'fld5OnZJZmx3cowl6', sentTo: 'fldyzofUxORdD6C7P', observed: 'fldBVzuEWrYKTJrep', notObserved: 'fld11lZ9ckVhWTnG3',
  summary: 'fldON9BJ2JcpZzaoD', note: 'fldKwV3IKzu72q7YM',
};
const S = { name: 'fldTBJ7i26yh7QLez', sendTo: 'fld6HLkbk1mKMq46D', lastRun: 'fldwPRrs7qX5Z7DfO', lastResult: 'fldJ9Yv9qnoS8e45Y' };

// ─── The form, as DeviceMagic had it (export, 2026-09-02) ───────────────────
const DEPOTS = ['Oromocto', 'Bagdad', 'River Glade'];
const ROUTES = {
  Oromocto: ['Oromocto East', 'Oromocto West', 'Mazerolle', 'Route 7'],                       // Western Division Plow Routes
  Bagdad: ['Bagdad East', 'Bagdad West', 'River Glade East', 'River Glade West'],             // Eastern Division Plow Routes
  'River Glade': ['Bagdad East', 'Bagdad West', 'River Glade East', 'River Glade West'],
};
const DIVISION = { Oromocto: 'Western', Bagdad: 'Eastern', 'River Glade': 'Eastern' };
// Every route once, Western then Eastern — the order the board and the PMCC report use.
const ALL_ROUTES = [...new Set([...ROUTES.Oromocto, ...ROUTES.Bagdad])];
const ROUTE_DIVISION = Object.fromEntries(ALL_ROUTES.map(r => [r, ROUTES.Oromocto.includes(r) ? 'Western' : 'Eastern']));
const CONDITIONS = ['Bare Full Width', 'Bare Driving Lanes', 'Bare Center Skip', 'Bare Wheel Tracks',
  'Light Snow Covered', 'Snow Covered', 'Snow Accumulating', 'Snow Packed', 'Slippery', 'Icy Spots', 'Slushy', 'Drifting Snow'];
/* Only for colouring the board — green / amber / red at a glance. It decides
   nothing: the alert is the patroller's call. */
function tone(conditions) {
  const c = conditions || [];
  if (c.some(x => ['Icy Spots', 'Slippery', 'Snow Packed', 'Drifting Snow'].includes(x))) return 'bad';
  if (c.some(x => !/^Bare /.test(x))) return 'caution';
  return c.length ? 'good' : '';
}
const SLOTS = ['06:00', '10:00', '14:00'];

// ─── Atlantic time ───────────────────────────────────────────────────────────
const TZ = 'America/Moncton';
function parts(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour === '24' ? '00' : p.hour), minute: Number(p.minute) };
}
const hhmm = d => { const p = parts(new Date(d)); return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
/* The instant that is HH:MM on date D in Moncton (handles the DST offset). */
function atAtlantic(date, time) {
  const guess = new Date(`${date}T${time}:00Z`);
  for (const off of [3, 4]) {
    const d = new Date(guess.getTime() + off * 3600000);
    const p = parts(d);
    if (p.date === date && `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}` === time) return d;
  }
  return new Date(guess.getTime() + 4 * 3600000);
}
/* 15 Oct → 15 Apr, OMM 601.2.2(b) — the same window as the patrol report. */
function inWinter(date) {
  const md = date.slice(5);
  return md >= '10-15' || md <= '04-15';
}

// ─── Observations ────────────────────────────────────────────────────────────
function newObsId(d = new Date()) {
  const p = parts(d), r = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, '0');
  return `RC-${p.date.replace(/-/g, '')}-${String(p.hour).padStart(2, '0')}${String(p.minute).padStart(2, '0')}-${r}`;
}
/* A posted observation → { fields } or { error }. Never trusts the client for who
   submitted it, and never accepts a route that is not that depot's. */
function cleanObservation(b, caller, now = new Date()) {
  b = b || {};
  const depot = String(b.depot || '');
  if (!DEPOTS.includes(depot)) return { error: 'Choose the depot.' };
  const route = String(b.route || '');
  if (!ROUTES[depot].includes(route)) return { error: `Choose a ${DIVISION[depot]} Division plow route.` };
  const conditions = [...new Set((Array.isArray(b.conditions) ? b.conditions : []).map(String))];
  if (!conditions.length) return { error: 'Pick the road conditions.' };
  const bad = conditions.filter(c => !CONDITIONS.includes(c));
  if (bad.length) return { error: `Unknown condition: ${bad.join(', ')}` };
  const comments = String(b.comments || '').trim();
  if (comments.length > 2000) return { error: 'Keep the comments under 2000 characters.' };
  let observedAt = now;
  if (b.observedAt) {
    const t = new Date(b.observedAt);
    if (isNaN(t.getTime())) return { error: 'The time of observation is not a time.' };
    if (t.getTime() > now.getTime() + 5 * 60000) return { error: 'The time of observation is in the future.' };
    if (t.getTime() < now.getTime() - 24 * 3600000) return { error: 'The time of observation is more than a day ago.' };
    observedAt = t;
  }
  const patroller = String(b.patroller || caller.name || '').trim().slice(0, 120);
  if (!patroller) return { error: 'Who made the observation?' };
  return { fields: {
    [F.obsId]: newObsId(observedAt), [F.observedAt]: observedAt.toISOString(), [F.depot]: depot, [F.division]: DIVISION[depot],
    [F.route]: route, [F.conditions]: conditions, [F.comments]: comments, [F.patroller]: patroller,
    [F.submittedBy]: caller.name || '', [F.submittedAt]: now.toISOString(),
  } };
}
function shapeObs(r) {
  const f = r.fields || {};
  return {
    id: r.id, observationId: f[F.obsId] || '', observedAt: f[F.observedAt] || '', depot: L.sel(f[F.depot]),
    division: L.sel(f[F.division]), route: L.sel(f[F.route]), conditions: L.arr(f[F.conditions]).map(L.sel),
    comments: f[F.comments] || '', patroller: f[F.patroller] || '', submittedBy: f[F.submittedBy] || '',
    submittedAt: f[F.submittedAt] || '', alertSent: !!f[F.alertSent], alertSentAt: f[F.alertAt] || '',
    alertSentTo: f[F.alertTo] || '',
  };
}
async function observationsSince(since) {
  const out = []; let offset;
  do {
    const qs = new URLSearchParams();
    qs.set('returnFieldsByFieldId', 'true'); qs.set('pageSize', '100');
    qs.set('filterByFormula', `IS_AFTER({Observed At}, '${new Date(since).toISOString()}')`);
    qs.set('sort[0][field]', 'Observed At'); qs.set('sort[0][direction]', 'desc');
    if (offset) qs.set('offset', offset);
    const page = await L.airtable(`${BASE}/${T_OBS}?${qs}`);
    out.push(...(page.records || []).map(shapeObs));
    offset = page.offset;
  } while (offset && out.length < 2000);
  // Re-checked here: the formula is not trusted alone.
  return out.filter(o => o.observedAt && new Date(o.observedAt) > new Date(since))
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
}
/* The newest observation of each route, in route order. */
function latestByRoute(obs) {
  return ALL_ROUTES.map(route => {
    const o = obs.filter(x => x.route === route).sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0] || null;
    return { route, division: ROUTE_DIVISION[route], latest: o, tone: o ? tone(o.conditions) : '' };
  });
}

// ─── The PMCC report ─────────────────────────────────────────────────────────
/* The slot this instant falls in (cron runs at the top of the hour), or ''. */
function slotAt(now = new Date()) {
  const p = parts(now);
  const s = `${String(p.hour).padStart(2, '0')}:00`;
  return SLOTS.includes(s) && p.minute < 50 ? s : '';
}
/* The window a slot reports on: since the previous slot (06:00 looks back to
   14:00 yesterday). */
function windowFor(date, slot) {
  const end = atAtlantic(date, slot);
  const i = SLOTS.indexOf(slot);
  let start;
  if (i > 0) start = atAtlantic(date, SLOTS[i - 1]);
  else { const y = new Date(atAtlantic(date, '12:00').getTime() - 24 * 3600000); start = atAtlantic(parts(y).date, SLOTS[SLOTS.length - 1]); }
  return { start, end };
}
function buildReport(date, slot, obs) {
  const { start, end } = windowFor(date, slot);
  const inWin = obs.filter(o => new Date(o.observedAt) > start && new Date(o.observedAt) <= end);
  const rows = latestByRoute(inWin);
  const alerts = inWin.filter(o => o.alertSent);
  const observed = rows.filter(r => r.latest).length;
  const lines = [`MRDC road conditions — ${date} ${slot} (observations since ${hhmm(start)})`, ''];
  for (const div of ['Western', 'Eastern']) {
    lines.push(`${div} Division`);
    for (const r of rows.filter(x => x.division === div)) {
      lines.push(r.latest
        ? `  ${r.route}: ${r.latest.conditions.join(', ')} — ${hhmm(r.latest.observedAt)}, ${r.latest.patroller}${r.latest.comments ? ` (${r.latest.comments.replace(/\s+/g, ' ')})` : ''}`
        : `  ${r.route}: NOT OBSERVED since ${hhmm(start)}`);
    }
    lines.push('');
  }
  if (alerts.length) {
    lines.push('Adverse-conditions alerts in this period:');
    for (const a of alerts) lines.push(`  ${hhmm(a.observedAt)} ${a.route} — ${a.conditions.join(', ')} (${a.patroller})`);
  }
  const esc = L.esc;
  const tr = r => `<tr><td style="padding:4px 10px 4px 0">${esc(r.route)}</td>${r.latest
    ? `<td style="padding:4px 10px 4px 0"><b>${esc(r.latest.conditions.join(', '))}</b>${r.latest.comments ? `<br><span style="color:#555">${esc(r.latest.comments)}</span>` : ''}</td><td style="padding:4px 10px 4px 0;color:#555">${esc(hhmm(r.latest.observedAt))} · ${esc(r.latest.patroller)}</td>`
    : `<td colspan="2" style="padding:4px 0;color:#A32D2D"><b>Not observed</b> since ${esc(hhmm(start))}</td>`}</tr>`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#15243B">
    <h2 style="margin:0 0 4px;color:#1E2B5E">Road conditions — ${esc(date)} ${esc(slot)}</h2>
    <p style="margin:0 0 12px;color:#555">MRDC Operations, Route 2 / 7 / 8 facility. Latest observation on each plow route since ${esc(hhmm(start))}.</p>
    ${['Western', 'Eastern'].map(div => `<h3 style="margin:14px 0 4px">${div} Division</h3><table style="border-collapse:collapse">${rows.filter(r => r.division === div).map(tr).join('')}</table>`).join('')}
    ${alerts.length ? `<h3 style="margin:14px 0 4px;color:#A32D2D">Adverse-conditions alerts this period</h3><ul>${alerts.map(a => `<li>${esc(hhmm(a.observedAt))} ${esc(a.route)} — ${esc(a.conditions.join(', '))} (${esc(a.patroller)})</li>`).join('')}</ul>` : ''}
    <p style="margin-top:16px;font-size:12px;color:#777">From the MRDC Road Patrol app · OMM 601.2.2(g).</p></div>`;
  return { text: lines.join('\n').trim(), html, observed, notObserved: rows.length - observed, alerts: alerts.length, start, end };
}

// ─── Who gets what ───────────────────────────────────────────────────────────
const EMP_SUBS = 'fldFejJ45fAYDWJlW';                 // Employees → Email Subscriptions
const DL = { table: 'tblGXm5nDaxGppjVj', name: 'fldc22IrOlNLqIEKo', email: 'flderIfr2j2OpQbc1', subs: 'fldbJ8Qy4QHhBrTzm', status: 'fldshxalFiAb8egad' };
const ALERT_LIST = 'Winter Road Conditions';
const PMCC_LIST = 'PMCC Road Conditions';
/* Until anyone subscribes to the alert list, these job titles get it (Troy's
   "managers + patrollers"). Winter patrollers are seasonal and may be marked
   Inactive out of season, so they count whatever their status. */
const ALERT_TITLES = ['Area Manager', 'Operations Manager', 'General / Facility Manager', 'Supervisor / Operator',
  'Patroller - Full Time', 'Patroller - Winter'];
const okEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());

async function directory() {
  const people = []; let offset;
  do {
    const qs = new URLSearchParams();
    qs.set('pageSize', '100'); qs.set('returnFieldsByFieldId', 'true');
    for (const k of ['name', 'email', 'role', 'jobTitle', 'active']) qs.append('fields[]', L.EF[k]);
    qs.append('fields[]', EMP_SUBS);
    if (offset) qs.set('offset', offset);
    const page = await L.airtable(`${L.EMP_BASE}/${encodeURIComponent(L.EMP_TABLE)}?${qs}`);
    for (const r of page.records || []) {
      const f = r.fields || {};
      people.push({ name: f[L.EF.name] || '', email: String(f[L.EF.email] || '').trim(), role: L.sel(f[L.EF.role]),
        titles: L.arr(f[L.EF.jobTitle]).map(L.sel), active: L.sel(f[L.EF.active]) !== 'Inactive',
        subs: L.arr(f[EMP_SUBS]).map(L.sel) });
    }
    offset = page.offset;
  } while (offset);
  let lists = [];
  try {
    const qs = new URLSearchParams(); qs.set('returnFieldsByFieldId', 'true'); qs.set('pageSize', '100');
    const page = await L.airtable(`${L.EMP_BASE}/${DL.table}?${qs}`);
    lists = (page.records || []).map(r => { const f = r.fields || {};
      return { name: f[DL.name] || '', email: String(f[DL.email] || '').trim(), subs: L.arr(f[DL.subs]).map(L.sel), active: L.sel(f[DL.status]) !== 'Inactive' }; });
  } catch (_) { lists = []; }
  return { people, lists };
}
function owners(dir) { return dir.people.filter(p => p.active && p.role === 'Owner' && okEmail(p.email)).map(p => p.email); }
function subscribed(dir, list) {
  return [...dir.people.filter(p => p.active && p.subs.includes(list) && okEmail(p.email)).map(p => p.email),
          ...dir.lists.filter(l => l.active && l.subs.includes(list) && okEmail(l.email)).map(l => l.email)];
}
function alertRecipients(dir) {
  const subs = subscribed(dir, ALERT_LIST);
  if (subs.length) return [...new Set(subs.map(e => e.toLowerCase()))];
  return [...new Set(dir.people.filter(p => (p.active || p.titles.includes('Patroller - Winter')) &&
    p.titles.some(t => ALERT_TITLES.includes(t)) && okEmail(p.email)).map(p => p.email.toLowerCase()))];
}
function pmccRecipients(dir) { return [...new Set(subscribed(dir, PMCC_LIST).map(e => e.toLowerCase()))]; }

/* The on/off switch: 'Off' | 'Owner test' | 'Everyone'. A missing row is Off —
   a switch nobody set never mails anyone. */
async function switchFor(name) {
  const qs = new URLSearchParams(); qs.set('returnFieldsByFieldId', 'true');
  const page = await L.airtable(`${BASE}/${T_SWITCH}?${qs}`);
  const row = (page.records || []).find(r => String((r.fields || {})[S.name] || '').trim() === name);
  return { id: row ? row.id : null, mode: row ? (L.sel(row.fields[S.sendTo]) || 'Off') : 'Off' };
}
async function stampSwitch(sw, result) {
  if (!sw.id) return;
  await L.airtable(`${BASE}/${T_SWITCH}/${sw.id}`, { method: 'PATCH',
    body: JSON.stringify({ fields: { [S.lastRun]: new Date().toISOString(), [S.lastResult]: String(result).slice(0, 2000) } }) }).catch(() => {});
}
/* Who a message goes to, given the switch. Owner test sends the Owner a preview
   that names who it would have reached. */
function deliveryFor(mode, real, dir) {
  if (mode === 'Everyone') return { to: real, preview: false };
  if (mode === 'Owner test') return { to: owners(dir), preview: true };
  return { to: [], preview: false };
}

module.exports = {
  BASE, T_OBS, T_PMCC, T_SWITCH, F, P, S, DEPOTS, ROUTES, DIVISION, ALL_ROUTES, CONDITIONS, SLOTS, ALERT_LIST, PMCC_LIST, ALERT_TITLES,
  tone, parts, hhmm, atAtlantic, inWinter, newObsId, cleanObservation, shapeObs, observationsSince, latestByRoute,
  slotAt, windowFor, buildReport, directory, owners, subscribed, alertRecipients, pmccRecipients, switchFor, stampSwitch, deliveryFor,
};
