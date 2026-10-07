// api/animals.js — road-patrol-api (Vercel)
//
// Animals for the Road Patrol app (www.mrdc-htra.com/patrol/animals.html): a live SIGHTING
// or ROAD KILL, one form. Replaces the DeviceMagic "Animal Sightings" form. Troy, 2026-10-07:
// "we could roll road kill into this unless there is an mva to report with the roadkill such
// as a moose, bear, or deer" — so road kill is recorded here, and an animal that comes with an
// MVA to report goes on the MVA form instead (it already records the animal). The server
// refuses road kill flagged as an MVA, so the two never both hold the same carcass.
//
// Road kill (claude/road-kill-and-animal-sightings.md — OMM 409 and EPP 4.16):
//   - discovery starts a 24-hour clock (OMM 409.2.2(a));
//   - deer, moose, bear and birds of prey: MRDC calls DNR, DNR removes it, and the CALL closes
//     the record ("no longer our responsibility once they have been called" — Troy, 2026-09-02);
//   - anything else: MRDC buries it on the right-of-way; the record stays Open until it is.
// Sightings are recorded and counted (moose, bear and deer counts are reported). A sighting
// INSIDE the wildlife fence is a live hazard and emails the "Animal Sightings" subscribers —
// until anyone subscribes, the area managers and Operations Manager by job title — through
// the "Animal sighting email" switch in Patrol Notifications (Off / Owner test / Everyone).
// The record is saved first; an email that fails never loses it.
//
// Base MRDC-HTRA - Road Patrol (app2m7rkP51kLLpbe), table Animal Reports.
//
// GET   /api/animals?meta=1   -> { routes, species, dnrSpecies, directions, patrollers, me, admin }
// GET   /api/animals          -> { open, recent, counts }   open road kill (oldest first), the last
//                                 30 days, and this year's counts by species
// POST  /api/animals {kind, species, otherSpecies?, count, route, direction, km, ramp?, insideFence?,
//                     lat?, lng?, observedAt?, reportedBy?, notes?, mva?, closedNow?}
//                             -> { report, email }
// POST  /api/animals?id=rec…&action=close {by?, at?}  -> { report }   DNR called, or buried

const L = require('./_lib');
const C = require('./_conditions');
const { requireCaller } = require('./_auth');

const T_AN = 'tbl8avT8C3tPbP8n4';
const F = {
  id: 'fldntF65MWqNtLsqX', kind: 'fldF8U8m7ivNie4sk', status: 'fldbsktMlpA3U3ygr', species: 'fldLH79PAL71GBvE0',
  other: 'fld1l43LrJ2WoB2uo', count: 'fldPmtqID1UKrIa6W', route: 'fld44xgewEY9NY0LQ', direction: 'fldSmqSrBN1NimXRJ',
  km: 'fldX8GMrU2HSprU0I', ramp: 'fldcuOSlzWY33cLJc', inside: 'fldjgMzqqa6KbUuSx', lat: 'fld5jCKGHatY2e3yf',
  lng: 'flddiECWILOYJ8LIQ', observedAt: 'fldn99xV5zaKORfOY', reportedBy: 'flducvuwgZNuEm7bx', enteredBy: 'fld4OcFPJsDGzVvvz',
  notes: 'fldqLPWEa2UsjvebI', dnrAt: 'fld5ZUr460tj17El1', dnrBy: 'fldhxwKH4MqjMTczn', removedAt: 'fldvUGVl0cCR9tUhN',
  removedBy: 'fldmtdnSL25G2G6nF', closedEnteredBy: 'fldchmoYvn9kqJzGo', alertTo: 'fldaUaD51XayI5YHi', alertAt: 'fldI9orDx6wSjUk5A',
};
const KINDS = ['Sighting', 'Road kill'];
const SPECIES = ['Deer', 'Moose', 'Bear', 'Bird of prey', 'Other'];     // Troy, 2026-10-07 (+ bird of prey: DNR call)
const DNR = ['Deer', 'Moose', 'Bear', 'Bird of prey'];                  // road kill closed by the DNR call
const ROUTES = ['Route 1', 'Route 2', 'Route 7', 'Route 8'];
const DIRECTIONS = ['EB', 'WB', 'Both'];
const LIST = 'Animal Sightings';
const TITLES = ['Area Manager', 'Operations Manager'];
const SWITCH = 'Animal sighting email';
const RECENT_DAYS = 30;
const CLOCK_H = 24;                                                     // OMM 409.2.2(a)
const okEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());

function newId(d = new Date()) {
  const p = C.parts(d), r = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, '0');
  return `AN-${p.date.replace(/-/g, '')}-${String(p.hour).padStart(2, '0')}${String(p.minute).padStart(2, '0')}-${r}`;
}
function num(v, lo, hi) {
  if (v === '' || v == null) return NaN;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : NaN;
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
const needsDnr = species => DNR.includes(species);

function cleanReport(b, caller, now = new Date()) {
  b = b || {};
  const kind = String(b.kind || '');
  if (!KINDS.includes(kind)) return { error: 'Is it a sighting (alive) or road kill?' };
  if (kind === 'Road kill' && b.mva === true) return { error: 'There is an MVA to report — put the animal on the MVA form, not here.' };
  const species = String(b.species || '');
  if (!SPECIES.includes(species)) return { error: 'Pick the animal.' };
  const other = String(b.otherSpecies || '').trim().slice(0, 80);
  if (species === 'Other' && other.length < 2) return { error: 'Say what the animal was.' };
  const count = num(b.count == null || b.count === '' ? 1 : b.count, 1, 200);
  if (isNaN(count) || !Number.isInteger(count)) return { error: 'How many? (a whole number, 1 to 200)' };
  const route = String(b.route || '');
  if (!ROUTES.includes(route)) return { error: 'Pick the route.' };
  const direction = String(b.direction || '');
  if (!DIRECTIONS.includes(direction)) return { error: 'Pick the direction (EB, WB or both).' };
  const km = num(b.km, 0, 999.9);
  if (isNaN(km)) return { error: 'Give the KM (a number, e.g. 312.4).' };
  const ramp = String(b.ramp || '').trim();
  if (ramp.length > 100) return { error: 'Keep the ramp under 100 characters.' };
  const hasLat = !(b.lat === '' || b.lat == null), hasLng = !(b.lng === '' || b.lng == null);
  const lat = hasLat ? num(b.lat, 40, 50) : null, lng = hasLng ? num(b.lng, -75, -60) : null;
  if (hasLat !== hasLng || (hasLat && (isNaN(lat) || isNaN(lng)))) return { error: 'The GPS position is not right — tap "Use my location" again or clear it.' };
  const notes = String(b.notes || '').trim();
  if (notes.length > 2000) return { error: 'Keep the notes under 2000 characters.' };
  const t = when(b.observedAt, now, kind === 'Road kill' ? 'found' : 'seen'); if (t.error) return { error: t.error };
  const reportedBy = String(b.reportedBy || caller.name || '').trim().slice(0, 120);
  if (reportedBy.length < 2) return { error: 'Who saw it?' };
  const fields = {
    [F.id]: newId(t.at), [F.kind]: kind, [F.species]: species, [F.other]: species === 'Other' ? other : '', [F.count]: count,
    [F.route]: route, [F.direction]: direction, [F.km]: Math.round(km * 10) / 10, [F.ramp]: ramp,
    [F.inside]: kind === 'Sighting' && b.insideFence === true,
    [F.observedAt]: t.at.toISOString(), [F.reportedBy]: reportedBy, [F.enteredBy]: caller.name || '', [F.notes]: notes,
    [F.status]: kind === 'Sighting' ? 'Recorded' : 'Open',
  };
  if (hasLat) { fields[F.lat] = Math.round(lat * 1e6) / 1e6; fields[F.lng] = Math.round(lng * 1e6) / 1e6; }
  // Road kill already dealt with when it is filed (DNR called from the truck, or already buried).
  if (kind === 'Road kill' && b.closedNow === true) Object.assign(fields, closeFields(species, reportedBy, now, caller));
  return { fields };
}
function closeFields(species, by, at, caller) {
  const iso = at.toISOString();
  return needsDnr(species)
    ? { [F.status]: 'Closed', [F.dnrAt]: iso, [F.dnrBy]: by, [F.closedEnteredBy]: caller.name || '' }
    : { [F.status]: 'Closed', [F.removedAt]: iso, [F.removedBy]: by, [F.closedEnteredBy]: caller.name || '' };
}
function cleanClose(b, rep, caller, now = new Date()) {
  b = b || {};
  const t = when(b.at, now, needsDnr(rep.species) ? 'DNR call' : 'removal'); if (t.error) return { error: t.error };
  if (rep.observedAt && t.at.getTime() < new Date(rep.observedAt).getTime()) return { error: 'That is before it was found.' };
  const by = String(b.by || caller.name || '').trim().slice(0, 120);
  if (by.length < 2) return { error: needsDnr(rep.species) ? 'Who called DNR?' : 'Who removed it?' };
  return { fields: closeFields(rep.species, by, t.at, caller) };
}
function shape(r) {
  const f = r.fields || {};
  const species = L.sel(f[F.species]) || '';
  const observedAt = f[F.observedAt] || '';
  return {
    id: r.id, reportId: f[F.id] || '', kind: L.sel(f[F.kind]) || '', status: L.sel(f[F.status]) || '', species,
    otherSpecies: f[F.other] || '', count: f[F.count] ?? 1, route: L.sel(f[F.route]) || '', direction: L.sel(f[F.direction]) || '',
    km: f[F.km] ?? null, ramp: f[F.ramp] || '', insideFence: !!f[F.inside], lat: f[F.lat] ?? null, lng: f[F.lng] ?? null,
    observedAt, reportedBy: f[F.reportedBy] || '', enteredBy: f[F.enteredBy] || '', notes: f[F.notes] || '',
    dnrCalledAt: f[F.dnrAt] || '', dnrCalledBy: f[F.dnrBy] || '', removedAt: f[F.removedAt] || '', removedBy: f[F.removedBy] || '',
    alertEmailedTo: f[F.alertTo] || '', alertEmailedAt: f[F.alertAt] || '',
    needsDnr: needsDnr(species),
    dueAt: observedAt ? new Date(new Date(observedAt).getTime() + CLOCK_H * 3600000).toISOString() : '',
  };
}
const label = a => a.species === 'Other' ? (a.otherSpecies || 'Other') : a.species;
const where = a => `${a.route} ${a.direction} km ${Number(a.km).toFixed(1)}${a.ramp ? ` (${a.ramp})` : ''}`;

function recipients(dir) {
  const subs = C.subscribed(dir, LIST);
  if (subs.length) return [...new Set(subs.map(e => e.toLowerCase()))];
  return [...new Set(dir.people.filter(p => p.active && p.titles.some(t => TITLES.includes(t)) && okEmail(p.email))
    .map(p => p.email.toLowerCase()))];
}
function dt(iso) { const p = C.parts(new Date(iso)); return `${p.date} ${C.hhmm(iso)}`; }
function message(a, real, preview) {
  const esc = L.esc;
  const head = `${label(a).toUpperCase()}${a.count > 1 ? ` ×${a.count}` : ''} INSIDE THE FENCE`;
  const subject = `${preview ? '[TEST] ' : ''}Animal inside the fence — ${label(a)}${a.count > 1 ? ` ×${a.count}` : ''}, ${where(a)}`;
  const map = a.lat != null && a.lng != null ? `https://www.google.com/maps?q=${a.lat},${a.lng}` : '';
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#15243B">
    ${preview ? `<p style="background:#FDF0DD;padding:8px 10px;border-radius:6px"><b>Owner test.</b> With the switch on Everyone this would go to ${real.length} people: ${esc(real.join(', ') || 'nobody — no address found')}.</p>` : ''}
    <h2 style="margin:0 0 6px;color:#A32D2D">${esc(head)}</h2>
    <p style="margin:0 0 4px;font-size:17px"><b>${esc(where(a))}</b></p>
    <p style="margin:0 0 4px">Seen ${esc(dt(a.observedAt))} by ${esc(a.reportedBy)}</p>
    ${map ? `<p style="margin:0 0 4px"><a href="${esc(map)}">Map (${esc(a.lat)}, ${esc(a.lng)})</a></p>` : ''}
    ${a.notes ? `<p style="margin:8px 0 4px"><b>Notes:</b> ${esc(a.notes)}</p>` : ''}
    <p style="margin-top:14px"><a href="https://www.mrdc-htra.com/patrol/animals.html">Open animal reports</a></p>
    <p style="font-size:12px;color:#777">From the MRDC Road Patrol app · ${esc(a.reportId)}</p></div>`;
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
  else reason = sw.mode === 'Off' ? 'the animal sighting email switch is Off' : 'no recipient address found';
  const record = sent.length ? (preview ? `Owner test: ${sent.join(', ')} (would go to ${real.length})` : sent.join(', ')) : `not sent — ${reason}`;
  const upd = await L.airtable(`${C.BASE}/${T_AN}/${a.id}`, { method: 'PATCH',
    body: JSON.stringify({ returnFieldsByFieldId: true, fields: { [F.alertTo]: record, [F.alertAt]: new Date().toISOString() } }) });
  await C.stampSwitch(sw, `${new Date().toISOString().slice(0, 16)} ${a.reportId}: ${record}`);
  return { report: shape(upd), email: { mode: sw.mode, sent: sent.length, wouldReach: real.length, note: record } };
}

/* Counts by species for the year (moose, bear and deer are reported). Count, not rows:
   one sighting of 5 deer is 5 deer. */
function countsFor(rows, year) {
  const out = SPECIES.map(s => ({ species: s, sightings: 0, roadKill: 0 }));
  for (const a of rows) {
    if (!a.observedAt || C.parts(new Date(a.observedAt)).date.slice(0, 4) !== String(year)) continue;
    const row = out.find(o => o.species === a.species); if (!row) continue;
    if (a.kind === 'Sighting') row.sightings += Number(a.count) || 0;
    else if (a.kind === 'Road kill') row.roadKill += Number(a.count) || 0;
  }
  return { year, rows: out };
}
async function listAll(now = new Date()) {
  const out = []; let offset;
  const year = Number(C.parts(now).date.slice(0, 4));
  const since = new Date(now.getTime() - RECENT_DAYS * 24 * 3600000).toISOString();
  const yearStart = new Date(`${year}-01-01T04:00:00Z`).toISOString();
  const from = since < yearStart ? since : yearStart;
  do {
    const qs = new URLSearchParams();
    qs.set('returnFieldsByFieldId', 'true'); qs.set('pageSize', '100');
    qs.set('filterByFormula', `OR({Status}='Open', IS_AFTER({Observed At}, '${from}'))`);
    qs.set('sort[0][field]', 'Observed At'); qs.set('sort[0][direction]', 'desc');
    if (offset) qs.set('offset', offset);
    const page = await L.airtable(`${C.BASE}/${T_AN}?${qs}`);
    out.push(...(page.records || []).map(shape));
    offset = page.offset;
  } while (offset && out.length < 5000);
  // Re-checked here: the formula is not trusted alone.
  const open = out.filter(a => a.kind === 'Road kill' && a.status === 'Open').sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const recent = out.filter(a => a.observedAt >= since && !(a.kind === 'Road kill' && a.status === 'Open'))
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  return { open, recent, counts: countsFor(out, year) };
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
        return res.status(200).json({ routes: ROUTES, species: SPECIES, dnrSpecies: DNR, directions: DIRECTIONS,
          patrollers: patrollers.map(p => p.name), me: caller.name, admin: caller.isAdmin });
      }
      return res.status(200).json(await listAll());
    }
    if (req.method === 'POST') {
      const body = L.parseBody(req);
      if (Q.id) {
        if (!/^rec[A-Za-z0-9]{14}$/.test(String(Q.id))) return res.status(400).json({ error: 'Bad id' });
        if (Q.action !== 'close') return res.status(400).json({ error: 'Unknown action' });
        const qs = new URLSearchParams(); qs.set('returnFieldsByFieldId', 'true');
        const rep = shape(await L.airtable(`${C.BASE}/${T_AN}/${Q.id}?${qs}`));
        if (rep.kind !== 'Road kill') return res.status(400).json({ error: 'Only road kill is closed.' });
        if (rep.status === 'Closed') {
          const done = rep.dnrCalledAt ? `DNR called ${dt(rep.dnrCalledAt)} by ${rep.dnrCalledBy}` : `removed ${dt(rep.removedAt)} by ${rep.removedBy}`;
          return res.status(409).json({ error: `Already closed — ${done}.`, report: rep });
        }
        const c = cleanClose(body, rep, caller);
        if (c.error) return res.status(400).json({ error: c.error });
        const upd = shape(await L.airtable(`${C.BASE}/${T_AN}/${rep.id}`, { method: 'PATCH',
          body: JSON.stringify({ returnFieldsByFieldId: true, fields: c.fields }) }));
        return res.status(200).json({ report: upd });
      }
      const c = cleanReport(body, caller);
      if (c.error) return res.status(400).json({ error: c.error });
      const created = shape(await L.airtable(`${C.BASE}/${T_AN}`, { method: 'POST',
        body: JSON.stringify({ returnFieldsByFieldId: true, fields: c.fields }) }));
      if (!(created.kind === 'Sighting' && created.insideFence)) return res.status(201).json({ report: created, email: null });
      try { return res.status(201).json(await email(created)); }
      catch (e) { return res.status(201).json({ report: created, emailError: 'Saved, but the email did not go: ' + e.message }); }
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[animals]', e.message);
    return res.status(e.status === 404 ? 404 : 500).json({ error: e.status === 404 ? 'Not found' : (e.message || 'Server error') });
  }
};
module.exports.__test = { F, T_AN, KINDS, SPECIES, DNR, ROUTES, DIRECTIONS, TITLES, LIST, SWITCH, newId, cleanReport, cleanClose, shape,
  recipients, message, countsFor, listAll };
