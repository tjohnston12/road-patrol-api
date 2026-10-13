// api/concerns.js — road-patrol-api (Vercel)
//
// Winter Areas of Concern for the Road Patrol app (www.mrdc-htra.com/patrol/concerns.html).
// Replaces DeviceMagic "Winter - Areas of Concern". That form asked for neither a patroller nor a
// date, required nothing, and its mail rule misspelled the depot ("Bagda"), so a Bagdad concern
// was emailed to nobody. OMM 601.2.2(h): adverse conditions are reported immediately.
//
// Troy, 2026-10-13: a concern stays OPEN on the app's list, for every patroller to see, until
// someone marks it resolved with a note. Raising one emails the "Areas of Concern" list
// (fallback: Area Managers + Operations Manager) on the "Areas of concern email" switch in
// Patrol Notifications (Off / Owner test / Everyone). Depot mailboxes can be subscribed through
// Distribution Lists. The record is always saved first; an email that fails never loses it.
//
// Base MRDC-HTRA - Road Patrol (app2m7rkP51kLLpbe), table Areas of Concern.
//
// GET  /api/concerns?meta=1   -> { depots, routes, directions, patrollers, me }
// GET  /api/concerns          -> { open, recent }   open (oldest first) + resolved in the last 30 days
// POST /api/concerns {depot, route, direction, fromKm, toKm?, description, lat?, lng?, reportedBy?, observedAt?}
//                             -> { concern, email }
// POST /api/concerns?id=rec…&action=resolve {by?, at?, notes} -> { concern }

const L = require('./_lib');
const C = require('./_conditions');
const { requireCaller } = require('./_auth');

const T_AC = 'tbljQKCdR9P6DsYiL';
const F = {
  id: 'fldSwktl4oHbH9nwX', status: 'fldW7J3grLHursKHU', depot: 'fldjCIaSJ8gZ1bNjC', route: 'fldGcnqyyDfDbhyDv',
  direction: 'flduxKfJjSL4OZg0W', fromKm: 'fldz9wTOaL1iPiqG5', toKm: 'fld5jaxo9Q42Kw7sv', description: 'fldmITM3eCHPCcOc0',
  lat: 'fld8ojRaJLSnaq4Tq', lng: 'fldCOMflqUOTB2JKZ', observedAt: 'fldmr5tbNmbSK94vC', reportedBy: 'fldaX1kHURONR8gHJ',
  enteredBy: 'fldcPS6ugl0qZsSWi', resolvedAt: 'fldwS6OV5PiZ7Mpa9', resolvedBy: 'fld0qj69AJ8Kf7MM9',
  resolution: 'fldi8jO9cY4bYUaCy', resolvedEnteredBy: 'fld2yOXhuGr8tokKg', emailedTo: 'fldsa8KgZzg0VHppO', emailedAt: 'fldCMgV2lbhhGOtTu',
};
const DEPOTS = ['Oromocto', 'Bagdad', 'River Glade'];
const ROUTES = ['Route 1', 'Route 2', 'Route 7', 'Route 8'];
const DIRECTIONS = ['EB', 'WB', 'Both'];
const LIST = 'Areas of Concern';
const SWITCH = 'Areas of concern email';
const TITLES = ['Area Manager', 'Operations Manager'];
const RECENT_DAYS = 30;
const okEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());

function newId(d = new Date()) {
  const p = C.parts(d), r = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, '0');
  return `AC-${p.date.replace(/-/g, '')}-${String(p.hour).padStart(2, '0')}${String(p.minute).padStart(2, '0')}-${r}`;
}
function num(v, lo, hi) {
  if (v === '' || v == null) return NaN;
  const x = Number(v);
  return Number.isFinite(x) && x >= lo && x <= hi ? x : NaN;
}
function when(v, now, label) {
  if (!v) return { at: now };
  const t = new Date(v);
  if (isNaN(t.getTime())) return { error: `The ${label} time is not a time.` };
  if (t.getTime() > now.getTime() + 5 * 60000) return { error: `The ${label} time is in the future.` };
  if (t.getTime() < now.getTime() - 24 * 3600000) return { error: `The ${label} time is more than a day ago — ask a supervisor to enter it in Airtable.` };
  return { at: t };
}
function cleanConcern(b, caller, now = new Date()) {
  b = b || {};
  const depot = String(b.depot || '');
  if (!DEPOTS.includes(depot)) return { error: 'Which depot — Oromocto, Bagdad or River Glade?' };
  const route = String(b.route || '');
  if (!ROUTES.includes(route)) return { error: 'Pick the route.' };
  const direction = String(b.direction || '');
  if (!DIRECTIONS.includes(direction)) return { error: 'Pick the direction (EB, WB or both).' };
  const fromKm = num(b.fromKm, 0, 999.9);
  if (isNaN(fromKm)) return { error: 'Give the KM where it starts (a number, e.g. 362.4).' };
  let toKm = null;
  if (!(b.toKm === '' || b.toKm == null)) {
    toKm = num(b.toKm, 0, 999.9);
    if (isNaN(toKm)) return { error: 'The "to" KM is not a number.' };
  }
  const description = String(b.description || '').trim();
  if (description.length < 3) return { error: 'Describe the concern.' };
  if (description.length > 2000) return { error: 'Keep the description under 2000 characters.' };
  const reportedBy = String(b.reportedBy || caller.name || '').trim().slice(0, 120);
  if (reportedBy.length < 2) return { error: 'Who is reporting it?' };
  const t = when(b.observedAt, now, 'reported'); if (t.error) return { error: t.error };
  const fields = {
    [F.id]: newId(t.at), [F.status]: 'Open', [F.depot]: depot, [F.route]: route, [F.direction]: direction,
    [F.fromKm]: Math.round(fromKm * 10) / 10, [F.description]: description,
    [F.observedAt]: t.at.toISOString(), [F.reportedBy]: reportedBy, [F.enteredBy]: caller.name || '',
  };
  if (toKm != null) fields[F.toKm] = Math.round(toKm * 10) / 10;
  const hasLat = !(b.lat === '' || b.lat == null), hasLng = !(b.lng === '' || b.lng == null);
  if (hasLat || hasLng) {
    const lat = num(b.lat, 40, 50), lng = num(b.lng, -75, -60);
    if (hasLat !== hasLng || isNaN(lat) || isNaN(lng)) return { error: 'The GPS position is not right — tap "Use my location" again or clear it.' };
    fields[F.lat] = Math.round(lat * 1e6) / 1e6; fields[F.lng] = Math.round(lng * 1e6) / 1e6;
  }
  return { fields };
}
function cleanResolve(b, ac, caller, now = new Date()) {
  b = b || {};
  const t = when(b.at, now, 'resolved'); if (t.error) return { error: t.error };
  if (ac.observedAt && t.at.getTime() < new Date(ac.observedAt).getTime()) return { error: 'That is before it was reported.' };
  const by = String(b.by || caller.name || '').trim().slice(0, 120);
  if (by.length < 2) return { error: 'Who resolved it?' };
  const notes = String(b.notes || '').trim();
  if (notes.length < 3) return { error: 'Say what was done, or why it is no longer a concern.' };
  if (notes.length > 2000) return { error: 'Keep the notes under 2000 characters.' };
  return { fields: { [F.status]: 'Resolved', [F.resolvedAt]: t.at.toISOString(), [F.resolvedBy]: by, [F.resolution]: notes, [F.resolvedEnteredBy]: caller.name || '' } };
}
function shape(r) {
  const f = r.fields || {};
  return {
    id: r.id, concernId: f[F.id] || '', status: L.sel(f[F.status]) || 'Open', depot: L.sel(f[F.depot]) || '',
    route: L.sel(f[F.route]) || '', direction: L.sel(f[F.direction]) || '', fromKm: f[F.fromKm] ?? null, toKm: f[F.toKm] ?? null,
    description: f[F.description] || '', lat: f[F.lat] ?? null, lng: f[F.lng] ?? null,
    observedAt: f[F.observedAt] || '', reportedBy: f[F.reportedBy] || '', enteredBy: f[F.enteredBy] || '',
    resolvedAt: f[F.resolvedAt] || '', resolvedBy: f[F.resolvedBy] || '', resolution: f[F.resolution] || '',
    emailedTo: f[F.emailedTo] || '', emailedAt: f[F.emailedAt] || '',
  };
}
const kmText = a => a.toKm != null && a.toKm !== a.fromKm ? `km ${Number(a.fromKm).toFixed(1)}–${Number(a.toKm).toFixed(1)}` : `km ${Number(a.fromKm).toFixed(1)}`;
const where = a => `${a.route} ${a.direction === 'Both' ? 'both directions' : a.direction} ${kmText(a)}`;
function recipients(dir) {
  const subs = C.subscribed(dir, LIST);
  if (subs.length) return [...new Set(subs.map(e => e.toLowerCase()))];
  return [...new Set(dir.people.filter(p => p.active && p.titles.some(t => TITLES.includes(t)) && okEmail(p.email))
    .map(p => p.email.toLowerCase()))];
}
function dt(iso) { const p = C.parts(new Date(iso)); return `${p.date} ${C.hhmm(iso)}`; }
function message(a, real, preview) {
  const esc = L.esc;
  const subject = `${preview ? '[TEST] ' : ''}Area of concern — ${where(a)} (${a.depot})`;
  const map = a.lat != null && a.lng != null ? `https://www.google.com/maps?q=${a.lat},${a.lng}` : '';
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#15243B">
    ${preview ? `<p style="background:#FDF0DD;padding:8px 10px;border-radius:6px"><b>Owner test.</b> With the switch on Everyone this would go to ${real.length} people: ${esc(real.join(', ') || 'nobody — no address found')}.</p>` : ''}
    <h2 style="margin:0 0 6px;color:#A35A00">AREA OF CONCERN — ${esc(where(a))}</h2>
    <table style="border-collapse:collapse;font-size:15px">
      <tr><td style="padding:2px 12px 2px 0;color:#555">Depot</td><td><b>${esc(a.depot)}</b></td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#555">Where</td><td><b>${esc(where(a))}</b></td></tr></table>
    <p style="margin:8px 0 4px"><b>Concern:</b> ${esc(a.description)}</p>
    <p style="margin:0 0 4px">Reported ${esc(dt(a.observedAt))} by ${esc(a.reportedBy)}</p>
    ${map ? `<p style="margin:0 0 4px"><a href="${esc(map)}">Map (${esc(a.lat)}, ${esc(a.lng)})</a></p>` : ''}
    <p style="margin-top:14px"><a href="https://www.mrdc-htra.com/patrol/concerns.html">Open areas of concern</a> — it stays on the list until someone marks it resolved.</p>
    <p style="font-size:12px;color:#777">From the MRDC Road Patrol app · ${esc(a.concernId)}</p></div>`;
  return { subject, html };
}
async function email(a) {
  const sw = await C.switchFor(SWITCH);
  const dir = await C.directory();
  const real = recipients(dir);
  const { to, preview } = C.deliveryFor(sw.mode, real, dir);
  const { subject, html } = message(a, real, preview);
  let sent = [], reason = '';
  if (to.length) ({ sent, reason } = await L.sendMailDetailed({ to, subject, html }));
  else reason = sw.mode === 'Off' ? 'the areas of concern email switch is Off' : 'no recipient address found';
  const record = sent.length ? (preview ? `Owner test: ${sent.join(', ')} (would go to ${real.length})` : sent.join(', ')) : `not sent — ${reason}`;
  const upd = await L.airtable(`${C.BASE}/${T_AC}/${a.id}`, { method: 'PATCH', body: JSON.stringify({ returnFieldsByFieldId: true,
    fields: { [F.emailedTo]: `Reported ${new Date().toISOString().slice(0, 16)}: ${record}`, [F.emailedAt]: new Date().toISOString() } }) });
  await C.stampSwitch(sw, `${new Date().toISOString().slice(0, 16)} ${a.concernId}: ${record}`);
  return { concern: shape(upd), email: { mode: sw.mode, sent: sent.length, wouldReach: real.length, note: record } };
}
async function listAll(now = new Date()) {
  const out = []; let offset;
  const since = new Date(now.getTime() - RECENT_DAYS * 24 * 3600000).toISOString();
  do {
    const qs = new URLSearchParams();
    qs.set('returnFieldsByFieldId', 'true'); qs.set('pageSize', '100');
    qs.set('filterByFormula', `OR({Status}='Open', IS_AFTER({Resolved At}, '${since}'))`);
    qs.set('sort[0][field]', 'Observed At'); qs.set('sort[0][direction]', 'desc');
    if (offset) qs.set('offset', offset);
    const page = await L.airtable(`${C.BASE}/${T_AC}?${qs}`);
    out.push(...(page.records || []).map(shape));
    offset = page.offset;
  } while (offset && out.length < 2000);
  const open = out.filter(a => a.status === 'Open').sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const recent = out.filter(a => a.status !== 'Open' && a.resolvedAt >= since).sort((a, b) => b.resolvedAt.localeCompare(a.resolvedAt));
  return { open, recent };
}

module.exports = async function handler(req, res) {
  if (L.cors(req, res)) return;
  const caller = await requireCaller(req, res);       // before the try (§2b)
  if (!caller) return;
  const Q = req.query || {};
  try {
    if (req.method === 'GET') {
      if (Q.meta) {
        const patrollers = await L.getPatrollers().catch(() => []);
        return res.status(200).json({ depots: DEPOTS, routes: ROUTES, directions: DIRECTIONS, patrollers: patrollers.map(p => p.name), me: caller.name });
      }
      return res.status(200).json(await listAll());
    }
    if (req.method === 'POST') {
      const body = L.parseBody(req);
      if (Q.id) {
        if (!/^rec[A-Za-z0-9]{14}$/.test(String(Q.id))) return res.status(400).json({ error: 'Bad id' });
        if (Q.action !== 'resolve') return res.status(400).json({ error: 'Unknown action' });
        const qs = new URLSearchParams(); qs.set('returnFieldsByFieldId', 'true');
        const ac = shape(await L.airtable(`${C.BASE}/${T_AC}/${Q.id}?${qs}`));
        if (ac.status !== 'Open') return res.status(409).json({ error: `Already resolved — ${dt(ac.resolvedAt)} by ${ac.resolvedBy}.`, concern: ac });
        const c = cleanResolve(body, ac, caller);
        if (c.error) return res.status(400).json({ error: c.error });
        const upd = shape(await L.airtable(`${C.BASE}/${T_AC}/${ac.id}`, { method: 'PATCH', body: JSON.stringify({ returnFieldsByFieldId: true, fields: c.fields }) }));
        return res.status(200).json({ concern: upd });
      }
      const c = cleanConcern(body, caller);
      if (c.error) return res.status(400).json({ error: c.error });
      const created = shape(await L.airtable(`${C.BASE}/${T_AC}`, { method: 'POST', body: JSON.stringify({ returnFieldsByFieldId: true, fields: c.fields }) }));
      try { return res.status(201).json(await email(created)); }
      catch (e) { return res.status(201).json({ concern: created, emailError: 'Saved, but the email did not go: ' + e.message }); }
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[concerns]', e.message);
    return res.status(e.status === 404 ? 404 : 500).json({ error: e.status === 404 ? 'Not found' : (e.message || 'Server error') });
  }
};
module.exports.__test = { F, T_AC, DEPOTS, ROUTES, DIRECTIONS, LIST, SWITCH, TITLES, cleanConcern, cleanResolve, shape, recipients, message, listAll, where, newId };
