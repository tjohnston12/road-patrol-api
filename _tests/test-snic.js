// test-snic.js — run with an ABSOLUTE path:
//   node <repo>/road-patrol-api/_tests/test-snic.js
// Zero dependencies; no browser, no network, no credentials.
//
// Winter Operations — SNIC events (2026-10-13). Troy: "Patroller logs event, timesheets fill
// detail"; patrollers, Supervisor / Operators and managers may log. Served by conditions.js
// (?kind=snic). Winter Plan 6.3: call-out, left the depot, shift changes, route cycle times,
// end of the weather event, end of SNIC operations, the spreader data.
'use strict';
const path = require('path');
const libPath = path.join(__dirname, '..', 'api', '_lib.js');
const realLib = require(libPath);
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, x) => { if (c) pass++; else { fail++; failures.push(n + (x !== undefined ? ` — ${String(x).slice(0, 300)}` : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), `got ${JSON.stringify(g)} want ${JSON.stringify(w)}`);

let DB, seq = 0, EMPS;
const P = (name, titles, role, active = true) => ({ name, email: '', depot: '', role: role || '', titles, apps: ['Patrol'], active });
function reset() {
  DB = { sn: [] }; seq = 0;
  EMPS = [P('Troy Johnston', ['Quality Manager'], 'Owner'), P('Tom Gibson', ['Patroller - Full Time']), P('James Rodey', ['Patroller - Winter']),
    P('Op Erator', ['Supervisor / Operator']), P('Derek Melanson', ['Area Manager']), P('Brent Ross', ['Bridge Crew']), P('Gone Patroller', ['Patroller - Full Time'], '', false)];
}
const T = { tblAzdJ7h7xrzz3F1: 'sn' };
async function airtable(p, opts = {}) {
  const u = String(p), method = opts.method || 'GET';
  const m = u.match(/^(app[A-Za-z0-9]+)\/([A-Za-z0-9%]+)(?:\/(rec[A-Za-z0-9]+))?/);
  const key = T[decodeURIComponent(m[2])];
  if (!key) throw new Error('table? ' + u);
  const rows = DB[key];
  if (m[3]) {
    const r = rows.find(x => x.id === m[3]);
    if (!r) { const e = new Error('NOT_FOUND'); e.status = 404; throw e; }
    if (method === 'PATCH') Object.assign(r.fields, JSON.parse(opts.body).fields);
    return JSON.parse(JSON.stringify(r));
  }
  if (method === 'POST') { const r = { id: ('recNEW' + String(++seq).padStart(11, '0')).slice(0, 17), fields: JSON.parse(opts.body).fields }; rows.push(r); return JSON.parse(JSON.stringify(r)); }
  // Selects come back as objects, the way Airtable sends them.
  return { records: JSON.parse(JSON.stringify(rows)).map(r => { const f = r.fields;
    for (const k of ['fldkPqn70iTlkfdye', 'fld5sqAuAnj4arLBm', 'fldtZzTbuGk0nyrk7']) if (typeof f[k] === 'string') f[k] = { name: f[k] };
    for (const k of ['fld69OnAodqqqyLlN', 'fldxTy8YyP4bXvgOM']) if (Array.isArray(f[k])) f[k] = f[k].map(n => ({ name: n }));
    return r; }) };
}
require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: Object.assign({}, realLib, {
  airtable, getEmployees: async () => EMPS, getPatrollers: async () => EMPS.filter(p => p.active),
  sendMailDetailed: async () => { throw new Error('no mail expected'); },
}) };
let session = null;
global.fetch = async url => {
  if (/\/api\/session/.test(String(url))) return session ? { ok: true, status: 200, json: async () => session } : { ok: false, status: 401, json: async () => ({ ok: false }) };
  throw new Error('unexpected fetch ' + url);
};
const S = (name, orgRole = 'Employee', appRole = 'User') => ({ ok: true, allowed: true, appRole, apps: ['Patrol'], user: { name, role: orgRole, source: 'employee', employeeId: 'recX' } });
const handler = require(path.join(__dirname, '..', 'api', 'conditions.js'));
const X = require(path.join(__dirname, '..', 'api', '_snic.js')).__test, F = X.F;
async function call(method, query, body) {
  const req = { method, query: Object.assign({ kind: 'snic' }, query || {}), body, headers: { cookie: 'htra_session=abc', origin: 'https://www.mrdc-htra.com' } };
  let code = 0, out = null;
  const res = { setHeader() {}, status(c) { code = c; return this; }, json(o) { out = o; return this; }, end() { return this; } };
  await handler(req, res);
  return { code, body: out };
}
const ago = m => new Date(Date.now() - m * 60000).toISOString();
const NEW = { depot: 'Oromocto', routes: ['Mazerolle', 'Route 7'], operations: ['Plowing', 'Spreading'] };

(async () => {
  reset();
  const caller = { name: 'Tom Gibson', isAdmin: false };
  const NOW = new Date('2027-01-20T09:00:00Z');
  /* 1 — the rules */
  let c = X.cleanNew({ ...NEW, calledOutAt: '2027-01-20T06:10:00Z' }, caller, NOW);
  ok('a new event is accepted', !c.error, c.error);
  eq('…open, the depot\'s division, routes and operations, called out by the signed-in user', [c.fields[F.status], c.fields[F.division], c.fields[F.routes], c.fields[F.operations], c.fields[F.calledOutBy]],
     ['Open', 'Western', ['Mazerolle', 'Route 7'], ['Plowing', 'Spreading'], 'Tom Gibson']);
  ok('…an id in Atlantic time', /^SN-20270120-0210-[A-Z0-9]{4}$/.test(c.fields[F.id]), c.fields[F.id]);
  const err = b => (X.cleanNew(b, caller, NOW).error || '');
  ok('no depot: refused', /Which depot/.test(err({ ...NEW, depot: '' })));
  ok('a route of the other division: dropped; none left → refused', /Which Oromocto plow routes/.test(err({ ...NEW, routes: ['Bagdad East'] })));
  ok('no operation: refused', /type of operations/.test(err({ ...NEW, operations: [] })));
  ok('a call-out in the future: refused', /future/.test(err({ ...NEW, calledOutAt: '2027-01-20T10:00:00Z' })));
  ok('a call-out over 7 days ago: refused', /more than 7 days/.test(err({ ...NEW, calledOutAt: '2027-01-10T10:00:00Z' })));
  ok('left the depot before the call-out: refused', /before the call-out/.test(err({ ...NEW, calledOutAt: '2027-01-20T06:10:00Z', departedAt: '2027-01-20T06:00:00Z' })));
  eq('Bagdad and River Glade are Eastern', ['Bagdad', 'River Glade'].map(d => X.cleanNew({ depot: d, routes: ['Bagdad East'], operations: ['DLA'] }, caller, NOW).fields[F.division]), ['Eastern', 'Eastern']);
  // route cycles
  const ev = { calledOutAt: '2027-01-20T06:10:00Z', departedAt: '2027-01-20T06:40:00Z', routes: ['Mazerolle', 'Route 7'], timeline: [] };
  let l = X.cleanLog({ kind: 'Route cycle', route: 'Mazerolle', at: '2027-01-20T08:55:00Z' }, ev, caller, NOW);
  eq('the first cycle on a route: from leaving the depot', [l.entry.minutes, l.entry.from], [135, 'left the depot']);
  l = X.cleanLog({ kind: 'Route cycle', route: 'Mazerolle', at: '2027-01-20T08:59:00Z' }, { ...ev, timeline: [l.entry] }, caller, NOW);
  eq('the next: from the previous cycle on that route', [l.entry.minutes, l.entry.from], [4, 'previous cycle']);
  l = X.cleanLog({ kind: 'Route cycle', route: 'Route 7', at: '2027-01-20T08:00:00Z' }, { ...ev, departedAt: '' }, caller, NOW);
  eq('no departure recorded: from the call-out', [l.entry.minutes, l.entry.from], [110, 'call-out']);
  ok('a cycle on a route not on the event: refused', /Which of this event/.test(X.cleanLog({ kind: 'Route cycle', route: 'Oromocto East' }, ev, caller, NOW).error));
  ok('a shift change says who', /who came on/i.test(X.cleanLog({ kind: 'Shift change' }, ev, caller, NOW).error));
  ok('a note needs text', /Write the note/.test(X.cleanLog({ kind: 'Note', text: '' }, ev, caller, NOW).error));
  ok('an unknown kind: refused', /Shift change, route cycle or note/.test(X.cleanLog({ kind: 'Lunch' }, ev, caller, NOW).error));
  // closing
  ok('closing needs the end of the weather event if not recorded', /weather event end/.test(X.cleanClose({}, ev, caller, NOW).error));
  c = X.cleanClose({ weatherEndedAt: '2027-01-20T08:00:00Z', spreaderData: 'Salt 120 kg/2-lane km', timesheetSummary: 'crew…' }, { ...ev, notes: '' }, caller, NOW);
  eq('…closed, by, ended now, the spreader data and the timesheet summary kept', [c.fields[F.status], c.fields[F.closedBy], c.fields[F.endedAt], c.fields[F.weatherEndedAt], c.fields[F.spreader], c.fields[F.summary]],
     ['Closed', 'Tom Gibson', NOW.toISOString(), '2027-01-20T08:00:00.000Z', 'Salt 120 kg/2-lane km', 'crew…']);
  eq('…weather already recorded: not asked again', X.cleanClose({}, { ...ev, weatherEndedAt: '2027-01-20T07:00:00Z', notes: '' }, caller, NOW).fields[F.weatherEndedAt], '2027-01-20T07:00:00Z');

  /* 2 — who may log */
  const can = async n => X.canLog({ name: n, isAdmin: false }, EMPS);
  eq('patroller, winter patroller, Supervisor / Operator, Area Manager, the Owner: yes', await Promise.all(['Tom Gibson', 'James Rodey', 'Op Erator', 'Derek Melanson', 'Troy Johnston'].map(can)), [true, true, true, true, true]);
  eq('bridge crew, or someone not on the list: no', await Promise.all(['Brent Ross', 'Nobody'].map(can)), [false, false]);
  eq('an admin: yes', await X.canLog({ name: 'Nobody', isAdmin: true }, EMPS), true);
  eq('employee list unreadable: the Patrol access is enough', await X.canLog({ name: 'Nobody', isAdmin: false }, []), true);

  /* 3 — the endpoint */
  session = null;
  eq('signed out: 401', (await call('GET', {})).code, 401);
  session = S('Tom Gibson');
  const meta = (await call('GET', { meta: '1' })).body;
  eq('meta: depots, routes by depot, operations, log kinds, who can log, me', [meta.depots, meta.routes.Oromocto, meta.operations, meta.logKinds, meta.people, meta.me, meta.canLog],
     [['Oromocto', 'Bagdad', 'River Glade'], ['Oromocto East', 'Oromocto West', 'Mazerolle', 'Route 7'], ['Plowing', 'Spreading', 'DLA', 'Snow Removal / Blowing', 'Drainage Prep'],
      ['Shift change', 'Route cycle', 'Note'], ['Tom Gibson', 'James Rodey', 'Op Erator', 'Derek Melanson'], 'Tom Gibson', true]);
  let r = await call('POST', {}, { ...NEW, calledOutAt: ago(120) });
  eq('a new event: 201, open', [r.code, r.body.event && r.body.event.status, r.body.event && r.body.event.depot], [201, 'Open', 'Oromocto']);
  const id = r.body.event.id;
  r = await call('POST', {}, { ...NEW, calledOutAt: ago(30) });
  ok('a second open event at the same depot: 409, naming the open one', r.code === 409 && /already has an open SNIC event/.test(r.body.error) && r.body.event.id === id, JSON.stringify(r.body).slice(0, 200));
  eq('…another depot is fine', (await call('POST', {}, { depot: 'Bagdad', routes: ['Bagdad East'], operations: ['DLA'] })).code, 201);
  eq('left the depot', (await call('POST', { id, action: 'departed' }, { at: ago(100) })).body.event.departedAt.slice(0, 16), ago(100).slice(0, 16));
  r = await call('POST', { id, action: 'log' }, { kind: 'Route cycle', route: 'Mazerolle', at: ago(40) });
  eq('a route cycle: 60 min from leaving the depot', [r.code, r.body.entry.minutes, r.body.event.timeline.length], [200, 60, 1]);
  r = await call('POST', { id, action: 'log' }, { kind: 'Shift change', text: 'James on, Tom off', at: ago(50) });
  eq('a shift change, kept in time order', r.body.event.timeline.map(e => e.kind), ['Shift change', 'Route cycle']);
  eq('…stored as JSON on the record', JSON.parse(DB.sn[0].fields[F.timeline]).length, 2);
  r = await call('POST', { id, action: 'update' }, { routes: ['Route 7'] });
  ok('a route with a cycle logged cannot be taken off', r.code === 400 && /Mazerolle has a route cycle/.test(r.body.error), JSON.stringify(r.body));
  r = await call('POST', { id, action: 'update' }, { routes: ['Mazerolle', 'Route 7', 'Oromocto East'], operations: ['Plowing', 'Spreading', 'Snow Removal / Blowing'] });
  eq('routes and operations added as the storm grows', [r.body.event.routes, r.body.event.operations], [['Mazerolle', 'Route 7', 'Oromocto East'], ['Plowing', 'Spreading', 'Snow Removal / Blowing']]);
  eq('weather ended', (await call('POST', { id, action: 'weather' }, { at: ago(20) })).code, 200);
  r = await call('GET', {});
  eq('the board: both open, oldest first', [r.code, r.body.open.map(e => e.depot), r.body.closed.length], [200, ['Oromocto', 'Bagdad'], 0]);
  r = await call('POST', { id, action: 'close' }, { spreaderData: 'Salt 120 kg/2-lane km', timesheetSummary: 'Brent Ross 01:00–09:00 6020 Mazerolle 2121-46 salt 4.5 t' });
  eq('ended: 200, closed, by me', [r.code, r.body.event.status, r.body.event.closedBy, !!r.body.event.endedAt], [200, 'Closed', 'Tom Gibson', true]);
  r = await call('POST', { id, action: 'log' }, { kind: 'Note', text: 'late' });
  ok('anything on an ended event: 409', r.code === 409 && /was ended/.test(r.body.error), JSON.stringify(r.body));
  r = await call('GET', {});
  eq('…on the closed list, off the open one', [r.body.open.map(e => e.depot), r.body.closed.map(e => e.depot)], [['Bagdad'], ['Oromocto']]);
  eq('Oromocto can open a new event now', (await call('POST', {}, { ...NEW })).code, 201);
  eq('bad id: 400', (await call('POST', { id: 'nope', action: 'log' }, {})).code, 400);
  eq('unknown action: 400', (await call('POST', { id, action: 'delete' }, {})).code, 400);
  eq('unknown kind on conditions.js: 400', (await (async () => { const req = { method: 'GET', query: { kind: 'x' }, headers: { cookie: 'htra_session=abc', origin: 'https://www.mrdc-htra.com' } };
    let code = 0; const res = { setHeader() {}, status(c) { code = c; return this; }, json() { return this; }, end() { return this; } }; await handler(req, res); return code; })()), 400);
  session = S('Brent Ross');
  const before = DB.sn.length;
  r = await call('POST', {}, { depot: 'River Glade', routes: ['River Glade East'], operations: ['Plowing'] });
  ok('bridge crew cannot log: 403, nothing saved', r.code === 403 && DB.sn.length === before && /patrollers, Supervisor \/ Operators and managers/.test(r.body.error), JSON.stringify(r.body));
  eq('…but can read the board', (await call('GET', {})).code, 200);

  console.log(failures.map(f => '   FAIL  ' + f).join('\n'));
  console.log(`\n  test-snic: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
