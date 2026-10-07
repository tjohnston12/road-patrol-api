// api/advisories.js — road-patrol-api (Vercel)
//
// No Travel Advisories for the Road Patrol app (www.mrdc-htra.com/patrol/advisories.html).
// Replaces the two DeviceMagic forms "Winter - No Travel Advisory - ISSUED" and
// "... - LIFTED" (exports read 2026-10-07). Troy chose it on 2026-10-07: the Winter
// Operations Plan §5.2.3 names the DeviceMagic form as the way an advisory is
// recorded, so it has to exist here before the season.
//
// The fix the legacy data asked for (claude/road-patrol-phase-3-legacy-recon.md §2):
// ONE record per advisory. It is issued, and later LIFTED ON THE SAME RECORD — the
// two DeviceMagic forms made two unlinked rows, so "is an advisory on right now?"
// could not be answered. Also: KM is the record (the old forms asked exits AND km and
// they contradicted each other); exits or place names can go in the optional Section;
// times are real date-times; and lifting needs a name (the LIFTED form did not ask).
//
// Base MRDC-HTRA - Road Patrol (app2m7rkP51kLLpbe), table Travel Advisories.
//
// GET   /api/advisories?meta=1        -> { routes, types, patrollers, me, admin }
// GET   /api/advisories               -> { active, recent }   active + lifted in the last 30 days
// POST  /api/advisories {type, routes, fromKm, toKm, section?, reason, issuedBy?, issuedAt?}
//                                     -> { advisory, email }
// POST  /api/advisories?id=rec…&action=lift {liftedBy?, liftedAt?, notes?} -> { advisory, email }
//
// Email on issue and on lift to the "Travel Advisories" subscribers — or, until anyone
// subscribes, the management group the Winter Plan names (area managers, general
// manager, safety manager, quality manager) by job title — through the "Travel advisory
// email" switch in Patrol Notifications (Off / Owner test / Everyone). The record is
// saved first; an email that fails never loses the advisory.

const L = require('./_lib');
const C = require('./_conditions');
const { requireCaller } = require('./_auth');

const T_ADV = 'tblF6YUnUTdRF6e3K';
const A = {
  id: 'fldR66RqnIuWDoo87', status: 'fldj4a1FxxKRRn156', type: 'fldlPAUGqbYBGPzMI', routes: 'fldJsHqCjOdV1JFda',
  fromKm: 'fldN3EvJGYJbW5i0R', toKm: 'fldmH0f6LbXLFDPr2', section: 'fldEFSaeWWUWV78o1', reason: 'fldpMtwAAlrjYiC5n',
  issuedAt: 'fldCO1lSuX1LPWGGc', issuedBy: 'fldsyf6ZZ2CYAIYhj', issueEnteredBy: 'fldkIpMZvJmRUdfZj',
  issueEmailedTo: 'fldSMjKgeljnwMOYT', issueEmailedAt: 'fldP4zmkYBYKOrJEd',
  liftedAt: 'fldjEpRpoHsqYZtRb', liftedBy: 'fld09tb5AmipqZEJI', liftEnteredBy: 'fldXtkePVKOE4HRnI', liftNotes: 'fldlpxgeq0fvSmpQg',
  liftEmailedTo: 'fldnhFzyHh6a8Souk', liftEmailedAt: 'fldwKMupx47JNfZp2',
};
const ROUTES = ['Route 1', 'Route 2', 'Route 7', 'Route 8'];          // the DeviceMagic list
const TYPES = ['No Travel Advisory', 'Highway Closed / Emergency Vehicles Only'];   // Winter Plan §5.2.3, the two protocols
const LIST = 'Travel Advisories';
// Winter Plan §5.2.3: "email to the management group (area managers, general manager,
// safety manager, quality manager)". Operations Manager sits with the area managers.
const TITLES = ['Area Manager', 'Operations Manager', 'General / Facility Manager', 'Safety / Training Manager', 'Quality Manager'];
const SWITCH = 'Travel advisory email';
const RECENT_DAYS = 30;
const okEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());

function newId(d = new Date()) {
  const p = C.parts(d), r = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, '0');
  return `NTA-${p.date.replace(/-/g, '')}-${String(p.hour).padStart(2, '0')}${String(p.minute).padStart(2, '0')}-${r}`;
}
function km(v) {
  if (v === '' || v == null) return NaN;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 1000 ? Math.round(n * 1000) / 1000 : NaN;
}
/* A time the user gave, or now. Not in the future; not more than a day back. */
function when(v, now, label) {
  if (!v) return { at: now };
  const t = new Date(v);
  if (isNaN(t.getTime())) return { error: `The ${label} time is not a time.` };
  if (t.getTime() > now.getTime() + 5 * 60000) return { error: `The ${label} time is in the future.` };
  if (t.getTime() < now.getTime() - 24 * 3600000) return { error: `The ${label} time is more than a day ago — ask a supervisor to enter it in Airtable.` };
  return { at: t };
}
function cleanIssue(b, caller, now = new Date()) {
  b = b || {};
  const type = String(b.type || TYPES[0]);
  if (!TYPES.includes(type)) return { error: 'Choose the kind of advisory.' };
  const routes = ROUTES.filter(r => (Array.isArray(b.routes) ? b.routes : []).map(String).includes(r));
  if (!routes.length) return { error: 'Pick the route(s).' };
  if ((Array.isArray(b.routes) ? b.routes : []).some(r => !ROUTES.includes(String(r)))) return { error: 'Unknown route.' };
  const fromKm = km(b.fromKm), toKm = km(b.toKm);
  if (isNaN(fromKm) || isNaN(toKm)) return { error: 'Give the from and to KM (numbers, e.g. 257.2).' };
  if (fromKm === toKm) return { error: 'From and to KM are the same — give the section the advisory covers.' };
  const section = String(b.section || '').trim();
  if (section.length > 200) return { error: 'Keep the section under 200 characters.' };
  const reason = String(b.reason || '').trim();
  if (reason.length < 5) return { error: 'Give the conditions / reason for the advisory.' };
  if (reason.length > 2000) return { error: 'Keep the reason under 2000 characters.' };
  const t = when(b.issuedAt, now, 'issued'); if (t.error) return { error: t.error };
  const issuedBy = String(b.issuedBy || caller.name || '').trim().slice(0, 120);
  if (issuedBy.length < 2) return { error: 'Who issued it?' };
  return { fields: {
    [A.id]: newId(t.at), [A.status]: 'Active', [A.type]: type, [A.routes]: routes, [A.fromKm]: fromKm, [A.toKm]: toKm,
    [A.section]: section, [A.reason]: reason, [A.issuedAt]: t.at.toISOString(), [A.issuedBy]: issuedBy,
    [A.issueEnteredBy]: caller.name || '',
  } };
}
function cleanLift(b, adv, caller, now = new Date()) {
  b = b || {};
  const t = when(b.liftedAt, now, 'lifted'); if (t.error) return { error: t.error };
  if (adv.issuedAt && t.at.getTime() < new Date(adv.issuedAt).getTime()) return { error: 'It cannot be lifted before it was issued.' };
  const liftedBy = String(b.liftedBy || caller.name || '').trim().slice(0, 120);
  if (liftedBy.length < 2) return { error: 'Who lifted it?' };
  const notes = String(b.notes || '').trim();
  if (notes.length > 2000) return { error: 'Keep the notes under 2000 characters.' };
  return { fields: { [A.status]: 'Lifted', [A.liftedAt]: t.at.toISOString(), [A.liftedBy]: liftedBy,
    [A.liftEnteredBy]: caller.name || '', [A.liftNotes]: notes } };
}
function shape(r) {
  const f = r.fields || {};
  return {
    id: r.id, advisoryId: f[A.id] || '', status: L.sel(f[A.status]) || 'Active', type: L.sel(f[A.type]) || TYPES[0],
    routes: L.arr(f[A.routes]).map(L.sel), fromKm: f[A.fromKm] ?? null, toKm: f[A.toKm] ?? null, section: f[A.section] || '',
    reason: f[A.reason] || '', issuedAt: f[A.issuedAt] || '', issuedBy: f[A.issuedBy] || '', issueEnteredBy: f[A.issueEnteredBy] || '',
    issueEmailedTo: f[A.issueEmailedTo] || '', issueEmailedAt: f[A.issueEmailedAt] || '',
    liftedAt: f[A.liftedAt] || '', liftedBy: f[A.liftedBy] || '', liftEnteredBy: f[A.liftEnteredBy] || '', liftNotes: f[A.liftNotes] || '',
    liftEmailedTo: f[A.liftEmailedTo] || '', liftEmailedAt: f[A.liftEmailedAt] || '',
  };
}
function recipients(dir) {
  const subs = C.subscribed(dir, LIST);
  if (subs.length) return [...new Set(subs.map(e => e.toLowerCase()))];
  return [...new Set(dir.people.filter(p => p.active && p.titles.some(t => TITLES.includes(t)) && okEmail(p.email))
    .map(p => p.email.toLowerCase()))];
}
const kmText = a => `km ${Number(a.fromKm).toFixed(1)}–${Number(a.toKm).toFixed(1)}`;
const where = a => `${a.routes.join(', ')} ${kmText(a)}${a.section ? ` (${a.section})` : ''}`;
function dt(iso) { const p = C.parts(new Date(iso)); return `${p.date} ${C.hhmm(iso)}`; }

function message(adv, kind, real, preview) {
  const esc = L.esc, lifted = kind === 'lifted';
  const head = `${adv.type.toUpperCase()} ${lifted ? 'LIFTED' : 'ISSUED'}`;
  const subject = `${preview ? '[TEST] ' : ''}${head} — ${where(adv)}`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#15243B">
    ${preview ? `<p style="background:#FDF0DD;padding:8px 10px;border-radius:6px"><b>Owner test.</b> With the switch on Everyone this would go to ${real.length} people: ${esc(real.join(', ') || 'nobody — no address found')}.</p>` : ''}
    <h2 style="margin:0 0 6px;color:${lifted ? '#1D7A46' : '#A32D2D'}">${esc(head)}</h2>
    <p style="margin:0 0 4px;font-size:17px"><b>${esc(adv.routes.join(', '))}</b> · ${esc(kmText(adv))}${adv.section ? ` · ${esc(adv.section)}` : ''}</p>
    <p style="margin:0 0 4px">Issued ${esc(dt(adv.issuedAt))} by ${esc(adv.issuedBy)}</p>
    ${lifted ? `<p style="margin:0 0 4px"><b>Lifted ${esc(dt(adv.liftedAt))} by ${esc(adv.liftedBy)}</b></p>` : ''}
    <p style="margin:8px 0 4px"><b>Conditions / reason:</b> ${esc(adv.reason)}</p>
    ${lifted && adv.liftNotes ? `<p style="margin:8px 0 4px"><b>Lift notes:</b> ${esc(adv.liftNotes)}</p>` : ''}
    <p style="margin-top:14px"><a href="https://www.mrdc-htra.com/patrol/advisories.html">Open travel advisories</a></p>
    <p style="font-size:12px;color:#777">From the MRDC Road Patrol app · Winter Operations Plan §5.2.3.</p></div>`;
  return { subject, html };
}
async function email(adv, kind) {
  const sw = await C.switchFor(SWITCH);
  const dir = await C.directory();
  const real = recipients(dir);
  const { to, preview } = C.deliveryFor(sw.mode, real, dir);
  const { subject, html } = message(adv, kind, real, preview);
  let sent = [], reason = '';
  if (to.length) ({ sent, reason } = await L.sendMailDetailed({ to, subject, html }));
  else reason = sw.mode === 'Off' ? 'the travel advisory email switch is Off' : 'no recipient address found';
  const record = sent.length ? (preview ? `Owner test: ${sent.join(', ')} (would go to ${real.length})` : sent.join(', ')) : `not sent — ${reason}`;
  const f = kind === 'lifted' ? { [A.liftEmailedTo]: record, [A.liftEmailedAt]: new Date().toISOString() }
                              : { [A.issueEmailedTo]: record, [A.issueEmailedAt]: new Date().toISOString() };
  const upd = await L.airtable(`${C.BASE}/${T_ADV}/${adv.id}`, { method: 'PATCH', body: JSON.stringify({ returnFieldsByFieldId: true, fields: f }) });
  await C.stampSwitch(sw, `${new Date().toISOString().slice(0, 16)} ${adv.advisoryId} ${kind}: ${record}`);
  return { advisory: shape(upd), email: { mode: sw.mode, sent: sent.length, wouldReach: real.length, note: record } };
}

async function listAll() {
  const out = []; let offset;
  const since = new Date(Date.now() - RECENT_DAYS * 24 * 3600000).toISOString();
  do {
    const qs = new URLSearchParams();
    qs.set('returnFieldsByFieldId', 'true'); qs.set('pageSize', '100');
    qs.set('filterByFormula', `OR({Status}='Active', IS_AFTER({Issued At}, '${since}'))`);
    qs.set('sort[0][field]', 'Issued At'); qs.set('sort[0][direction]', 'desc');
    if (offset) qs.set('offset', offset);
    const page = await L.airtable(`${C.BASE}/${T_ADV}?${qs}`);
    out.push(...(page.records || []).map(shape));
    offset = page.offset;
  } while (offset && out.length < 500);
  // Re-checked here: the formula is not trusted alone.
  const active = out.filter(a => a.status === 'Active').sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  const recent = out.filter(a => a.status !== 'Active' && a.issuedAt >= since).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  return { active, recent };
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
        return res.status(200).json({ routes: ROUTES, types: TYPES, patrollers: patrollers.map(p => p.name), me: caller.name, admin: caller.isAdmin });
      }
      return res.status(200).json(await listAll());
    }
    if (req.method === 'POST') {
      const body = L.parseBody(req);
      if (Q.id) {
        if (!/^rec[A-Za-z0-9]{14}$/.test(String(Q.id))) return res.status(400).json({ error: 'Bad id' });
        if (Q.action !== 'lift') return res.status(400).json({ error: 'Unknown action' });
        const qs = new URLSearchParams(); qs.set('returnFieldsByFieldId', 'true');
        const adv = shape(await L.airtable(`${C.BASE}/${T_ADV}/${Q.id}?${qs}`));
        if (adv.status === 'Lifted') return res.status(409).json({ error: `Already lifted ${dt(adv.liftedAt)} by ${adv.liftedBy}.`, advisory: adv });
        const c = cleanLift(body, adv, caller);
        if (c.error) return res.status(400).json({ error: c.error });
        const upd = shape(await L.airtable(`${C.BASE}/${T_ADV}/${adv.id}`, { method: 'PATCH',
          body: JSON.stringify({ returnFieldsByFieldId: true, fields: c.fields }) }));
        try { return res.status(200).json(await email(upd, 'lifted')); }
        catch (e) { return res.status(200).json({ advisory: upd, emailError: 'Lifted, but the email did not go: ' + e.message }); }
      }
      const c = cleanIssue(body, caller);
      if (c.error) return res.status(400).json({ error: c.error });
      const created = shape(await L.airtable(`${C.BASE}/${T_ADV}`, { method: 'POST',
        body: JSON.stringify({ returnFieldsByFieldId: true, fields: c.fields }) }));
      try { return res.status(201).json(await email(created, 'issued')); }
      catch (e) { return res.status(201).json({ advisory: created, emailError: 'Saved, but the email did not go: ' + e.message }); }
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[advisories]', e.message);
    return res.status(e.status === 404 ? 404 : 500).json({ error: e.status === 404 ? 'Not found' : (e.message || 'Server error') });
  }
};
module.exports.__test = { A, T_ADV, ROUTES, TYPES, TITLES, LIST, SWITCH, newId, km, cleanIssue, cleanLift, shape, recipients, message, listAll };
