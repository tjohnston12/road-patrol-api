/*
 * api/_snic.js — Winter Operations: SNIC events.
 * ---------------------------------------------------------------------------
 * Troy, 2026-10-13, the last Phase 3 form: "Patroller logs event, timesheets fill detail".
 * Replaces the DeviceMagic "Winter Operations" form ("Enter each SNIC event as it occurs").
 * Who may log one: patrollers, Supervisor / Operators and managers (Troy, same day) — the
 * DeviceMagic form had five hardcoded names.
 *
 * One record per event, from the call-out to the end of operations, with what the Winter
 * Plan §6.3 asks the daily work record to show: call-out time, departure from the depot,
 * shift changes, route cycle times, end of the weather event, end of SNIC operations — plus
 * the spreader-control data at the end. Trucks, material, quantities and hours are NOT typed
 * here: the operators already put them on their timesheet winter lines (6020 / 6025 / 6032 /
 * 6040 / 6092, truck + plow route + material), and the page reads them for the event's window
 * and routes from the timesheets API (view=snic). At closing, the page sends that summary to
 * be kept on the record as it stood.
 *
 * One open event per depot. Served by api/conditions.js (?kind=snic), so the project stays at
 * 11 serverless functions (the Hobby plan allows 12).
 *
 *   GET  ?kind=snic&meta=1                       -> { depots, routes, division, operations, logKinds, people, me, canLog }
 *   GET  ?kind=snic                              -> { open, closed }      closed = the last 30 days
 *   POST ?kind=snic {depot, routes, operations, calledOutAt?, departedAt?, calledOutBy?, notes?}
 *                                                -> { event }
 *   POST ?kind=snic&id=rec…&action=departed {at?}
 *   POST ?kind=snic&id=rec…&action=log {kind, at?, route?, text?}   Shift change | Route cycle | Note
 *   POST ?kind=snic&id=rec…&action=update {routes?, operations?}
 *   POST ?kind=snic&id=rec…&action=weather {at?}                    the weather event has ended
 *   POST ?kind=snic&id=rec…&action=close {at?, weatherEndedAt?, spreaderData?, notes?, timesheetSummary?}
 *
 * Base MRDC-HTRA - Road Patrol (app2m7rkP51kLLpbe), table SNIC Events.
 */
'use strict';
const L = require('./_lib');
const C = require('./_conditions');

const T_SNIC = 'tblAzdJ7h7xrzz3F1';
const F = {
  id: 'fldLMDcRBjkihFijA', status: 'fldkPqn70iTlkfdye', depot: 'fld5sqAuAnj4arLBm', division: 'fldtZzTbuGk0nyrk7',
  calledOutAt: 'fldWOZ6o9fGQNGENh', departedAt: 'flddApS6Q1mPMpJwZ', routes: 'fld69OnAodqqqyLlN', operations: 'fldxTy8YyP4bXvgOM',
  weatherEndedAt: 'fldV7Xueu73ZPviOU', endedAt: 'fldTEYLD58vyafiMs', timeline: 'fldwgvzOf59uXoa0s', spreader: 'fldm3psN1nH2iNNSz',
  notes: 'fldEyRU2TenRDWaKI', calledOutBy: 'fldouJXqiKh6GxrB2', enteredBy: 'fldhHa49VuKHOm2q0', closedBy: 'fldSfO9BZiTpKUxGM',
  summary: 'fldowNRniAqF98kJ8',
};
// The DeviceMagic form's types of operation, same names.
const OPERATIONS = ['Plowing', 'Spreading', 'DLA', 'Snow Removal / Blowing', 'Drainage Prep'];
const LOG_KINDS = ['Shift change', 'Route cycle', 'Note'];
// Who may log (Troy, 2026-10-13: patrollers, Supervisor / Operators, managers). Admins / the Owner too.
const SNIC_TITLES = ['Patroller - Full Time', 'Patroller - Winter', 'Supervisor / Operator', 'Area Manager', 'Operations Manager',
  'General / Facility Manager'];
const MAX_DAYS = 7;          // the timesheets' view=snic window
const RECENT_DAYS = 30;

const parseJSON = (s, d) => { try { const v = JSON.parse(s); return v == null ? d : v; } catch (_) { return d; } };
function shape(r) {
  const f = r.fields || {};
  return {
    id: r.id, eventId: f[F.id] || '', status: L.sel(f[F.status]) || 'Open', depot: L.sel(f[F.depot]) || '',
    division: L.sel(f[F.division]) || '', calledOutAt: f[F.calledOutAt] || '', departedAt: f[F.departedAt] || '',
    routes: L.arr(f[F.routes]).map(L.sel), operations: L.arr(f[F.operations]).map(L.sel),
    weatherEndedAt: f[F.weatherEndedAt] || '', endedAt: f[F.endedAt] || '',
    timeline: parseJSON(f[F.timeline], []), spreaderData: f[F.spreader] || '', notes: f[F.notes] || '',
    calledOutBy: f[F.calledOutBy] || '', enteredBy: f[F.enteredBy] || '', closedBy: f[F.closedBy] || '',
    timesheetSummary: f[F.summary] || '',
  };
}

/* May this caller log SNIC events? By job title from the employee list; an admin / the Owner
   always. If the list cannot be read, the Patrol app access already checked is enough. */
async function canLog(caller, employees) {
  if (caller.isAdmin) return true;
  const all = employees || await L.getEmployees().catch(() => []);
  if (!all.length) return true;
  const me = all.find(p => p.name.trim().toLowerCase() === String(caller.name || '').trim().toLowerCase());
  return !!me && (me.role === 'Owner' || me.titles.some(t => SNIC_TITLES.includes(t)));
}
async function people() {
  const all = await L.getEmployees().catch(() => []);
  return { all, names: all.filter(p => p.active && p.titles.some(t => SNIC_TITLES.includes(t))).map(p => p.name) };
}

/* A time sent by the page: blank → now; never in the future; never before `floor`. */
function at(v, now, floor, what) {
  const t = v ? new Date(v) : now;
  if (isNaN(t.getTime())) return { error: `${what}: that is not a time.` };
  if (t.getTime() > now.getTime() + 5 * 60000) return { error: `${what}: that is in the future.` };
  if (floor && t.getTime() < new Date(floor).getTime()) return { error: `${what}: that is before the call-out.` };
  return { at: t };
}
const pick = (v, list) => [...new Set((Array.isArray(v) ? v : []).map(x => String(x || '').trim()))].filter(x => list.includes(x));
function newEventId(d) {
  const p = C.parts(d), r = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, '0');
  return `SN-${p.date.replace(/-/g, '')}-${String(p.hour).padStart(2, '0')}${String(p.minute).padStart(2, '0')}-${r}`;
}

function cleanNew(b, caller, now = new Date()) {
  b = b || {};
  const depot = String(b.depot || '');
  if (!C.DEPOTS.includes(depot)) return { error: 'Which depot?' };
  const routes = pick(b.routes, C.ROUTES[depot]);
  if (!routes.length) return { error: `Which ${depot} plow routes?` };
  const operations = pick(b.operations, OPERATIONS);
  if (!operations.length) return { error: 'What type of operations — plowing, spreading, DLA, snow removal / blowing, drainage prep?' };
  const co = at(b.calledOutAt, now, null, 'Call-out');
  if (co.error) return co;
  if (co.at.getTime() < now.getTime() - MAX_DAYS * 86400000) return { error: `Call-out: more than ${MAX_DAYS} days ago — ask a supervisor to enter it in Airtable.` };
  let dep = null;
  if (b.departedAt) { const d = at(b.departedAt, now, co.at, 'Left the depot'); if (d.error) return d; dep = d.at; }
  const by = String(b.calledOutBy || caller.name || '').trim().slice(0, 120);
  if (by.length < 2) return { error: 'Who made the call-out?' };
  const notes = String(b.notes || '').trim();
  if (notes.length > 2000) return { error: 'Keep the notes under 2000 characters.' };
  return { fields: {
    [F.id]: newEventId(co.at), [F.status]: 'Open', [F.depot]: depot, [F.division]: C.DIVISION[depot],
    [F.calledOutAt]: co.at.toISOString(), [F.departedAt]: dep ? dep.toISOString() : null,
    [F.routes]: routes, [F.operations]: operations, [F.calledOutBy]: by, [F.enteredBy]: caller.name || by,
    [F.notes]: notes, [F.timeline]: '[]',
  } };
}

/* One timeline entry. A route cycle's time is from the previous cycle on that route — or,
   for the first, from leaving the depot (or the call-out if that was not recorded). */
function cleanLog(b, ev, caller, now = new Date()) {
  b = b || {};
  const kind = String(b.kind || '');
  if (!LOG_KINDS.includes(kind)) return { error: 'Shift change, route cycle or note?' };
  const t = at(b.at, now, ev.calledOutAt, kind); if (t.error) return t;
  const text = String(b.text || '').trim();
  if (text.length > 500) return { error: 'Keep it under 500 characters.' };
  const e = { kind, at: t.at.toISOString(), by: caller.name || '' };
  if (kind === 'Route cycle') {
    const route = String(b.route || '');
    if (!ev.routes.includes(route)) return { error: 'Which of this event\'s routes was the cycle on?' };
    const prev = ev.timeline.filter(x => x.kind === 'Route cycle' && x.route === route && x.at <= e.at).map(x => x.at).sort().pop()
      || ev.departedAt || ev.calledOutAt;
    e.route = route;
    e.minutes = Math.round((t.at.getTime() - new Date(prev).getTime()) / 60000);
    e.from = prev === ev.departedAt ? 'left the depot' : prev === ev.calledOutAt ? 'call-out' : 'previous cycle';
  } else if (kind === 'Note' && text.length < 2) return { error: 'Write the note.' };
  else if (kind === 'Shift change' && text.length < 2) return { error: 'Who came on, who went off?' };
  if (text) e.text = text;
  return { entry: e, timeline: [...ev.timeline, e].sort((x, y) => x.at.localeCompare(y.at)) };
}

function cleanClose(b, ev, caller, now = new Date()) {
  b = b || {};
  const end = at(b.at, now, ev.calledOutAt, 'Operations ended'); if (end.error) return end;
  if (end.at.getTime() - new Date(ev.calledOutAt).getTime() > MAX_DAYS * 86400000) return { error: `Operations ended: more than ${MAX_DAYS} days after the call-out.` };
  let weather = ev.weatherEndedAt;
  if (!weather) {
    if (!b.weatherEndedAt) return { error: 'When did the weather event end?' };
    const w = at(b.weatherEndedAt, now, ev.calledOutAt, 'Weather ended'); if (w.error) return w;
    weather = w.at.toISOString();
  }
  const spreader = String(b.spreaderData || '').trim();
  if (spreader.length > 2000) return { error: 'Keep the spreader data under 2000 characters.' };
  const notes = String(b.notes == null ? ev.notes : b.notes).trim();
  if (notes.length > 2000) return { error: 'Keep the notes under 2000 characters.' };
  const summary = String(b.timesheetSummary || '').trim().slice(0, 20000);
  return { fields: { [F.status]: 'Closed', [F.endedAt]: end.at.toISOString(), [F.weatherEndedAt]: weather,
    [F.spreader]: spreader, [F.notes]: notes, [F.closedBy]: caller.name || '', [F.summary]: summary } };
}

async function list(formula) {
  const out = []; let offset;
  do {
    const qs = new URLSearchParams(); qs.set('returnFieldsByFieldId', 'true'); qs.set('pageSize', '100');
    qs.set('filterByFormula', formula);
    if (offset) qs.set('offset', offset);
    const page = await L.airtable(`${C.BASE}/${T_SNIC}?${qs}`);
    out.push(...(page.records || []).map(shape));
    offset = page.offset;
  } while (offset && out.length < 500);
  return out;
}
async function board(now = new Date()) {
  const since = new Date(now.getTime() - RECENT_DAYS * 86400000).toISOString();
  const rows = await list(`OR({Status}='Open', IS_AFTER({Operations Ended At}, '${since}'))`);
  return {
    open: rows.filter(e => e.status === 'Open').sort((a, b) => a.calledOutAt.localeCompare(b.calledOutAt)),
    closed: rows.filter(e => e.status !== 'Open' && e.endedAt >= since).sort((a, b) => b.endedAt.localeCompare(a.endedAt)),
  };
}
async function getOne(id) {
  const qs = new URLSearchParams(); qs.set('returnFieldsByFieldId', 'true');
  return shape(await L.airtable(`${C.BASE}/${T_SNIC}/${id}?${qs}`));
}
async function patch(id, fields) {
  return shape(await L.airtable(`${C.BASE}/${T_SNIC}/${id}`, { method: 'PATCH', body: JSON.stringify({ returnFieldsByFieldId: true, fields }) }));
}

async function handle(req, res, caller) {
  const Q = req.query || {};
  if (req.method === 'GET') {
    if (Q.meta) {
      const p = await people();
      return res.status(200).json({ depots: C.DEPOTS, routes: C.ROUTES, division: C.DIVISION, operations: OPERATIONS, logKinds: LOG_KINDS,
        people: p.names, me: caller.name, canLog: await canLog(caller, p.all), maxDays: MAX_DAYS, winter: C.inWinter(C.parts(new Date()).date) });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(await board());
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await canLog(caller))) return res.status(403).json({ error: 'SNIC events are logged by patrollers, Supervisor / Operators and managers.' });
  const body = L.parseBody(req);
  if (!Q.id) {
    const c = cleanNew(body, caller);
    if (c.error) return res.status(400).json({ error: c.error });
    const depot = c.fields[F.depot];
    const already = (await list(`AND({Status}='Open', {Depot}='${depot}')`)).find(e => e.status === 'Open' && e.depot === depot);
    if (already) return res.status(409).json({ error: `${depot} already has an open SNIC event (${already.eventId}, called out ${C.hhmm(already.calledOutAt)}). Add to it, or end it first.`, event: already });
    const created = shape(await L.airtable(`${C.BASE}/${T_SNIC}`, { method: 'POST', body: JSON.stringify({ returnFieldsByFieldId: true, fields: c.fields }) }));
    return res.status(201).json({ event: created });
  }
  if (!/^rec[A-Za-z0-9]{14}$/.test(String(Q.id))) return res.status(400).json({ error: 'Bad id' });
  const action = String(Q.action || '');
  if (!['departed', 'log', 'update', 'weather', 'close'].includes(action)) return res.status(400).json({ error: 'Unknown action' });
  const ev = await getOne(Q.id);
  if (ev.status !== 'Open') return res.status(409).json({ error: `This event was ended at ${C.hhmm(ev.endedAt)} by ${ev.closedBy}.`, event: ev });
  const now = new Date();
  if (action === 'departed') {
    const t = at(body.at, now, ev.calledOutAt, 'Left the depot'); if (t.error) return res.status(400).json({ error: t.error });
    return res.status(200).json({ event: await patch(ev.id, { [F.departedAt]: t.at.toISOString() }) });
  }
  if (action === 'weather') {
    const t = at(body.at, now, ev.calledOutAt, 'Weather ended'); if (t.error) return res.status(400).json({ error: t.error });
    return res.status(200).json({ event: await patch(ev.id, { [F.weatherEndedAt]: t.at.toISOString() }) });
  }
  if (action === 'log') {
    const c = cleanLog(body, ev, caller, now); if (c.error) return res.status(400).json({ error: c.error });
    return res.status(200).json({ event: await patch(ev.id, { [F.timeline]: JSON.stringify(c.timeline) }), entry: c.entry });
  }
  if (action === 'update') {
    const routes = body.routes === undefined ? ev.routes : pick(body.routes, C.ROUTES[ev.depot]);
    const operations = body.operations === undefined ? ev.operations : pick(body.operations, OPERATIONS);
    if (!routes.length) return res.status(400).json({ error: 'Keep at least one route.' });
    if (!operations.length) return res.status(400).json({ error: 'Keep at least one type of operation.' });
    const cycled = ev.timeline.filter(x => x.kind === 'Route cycle').map(x => x.route).filter(r => !routes.includes(r));
    if (cycled.length) return res.status(400).json({ error: `${cycled[0]} has a route cycle logged; it stays on the event.` });
    return res.status(200).json({ event: await patch(ev.id, { [F.routes]: routes, [F.operations]: operations }) });
  }
  const c = cleanClose(body, ev, caller, now); if (c.error) return res.status(400).json({ error: c.error });
  return res.status(200).json({ event: await patch(ev.id, c.fields) });
}

module.exports = { handle, __test: { F, T_SNIC, OPERATIONS, LOG_KINDS, SNIC_TITLES, shape, canLog, cleanNew, cleanLog, cleanClose, board, newEventId } };
