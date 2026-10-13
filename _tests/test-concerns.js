// test-concerns.js — run with an ABSOLUTE path:
//   node <repo>/road-patrol-api/_tests/test-concerns.js
// Zero dependencies; no browser, no network, no credentials.
//
// Winter Areas of Concern (2026-10-13). Replaces the DeviceMagic form whose mail rule sent Bagdad
// concerns to nobody ("Bagda"). Troy: a concern stays Open on the list until someone resolves it
// with a note; raising one emails the "Areas of Concern" list (fallback Area Managers + Operations
// Manager) on the "Areas of concern email" switch.
'use strict';
const path = require('path');
const libPath = path.join(__dirname, '..', 'api', '_lib.js');
const realLib = require(libPath);
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, x) => { if (c) pass++; else { fail++; failures.push(n + (x !== undefined ? ` — ${String(x).slice(0, 300)}` : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), `got ${JSON.stringify(g)} want ${JSON.stringify(w)}`);
let DB, CALLS, MAIL, MAIL_FAIL = false, seq = 0;
const EMP = (id, name, email, titles, active, role) => ({ id, fields: { fldtLjh72SJV8Uyfb: name, fldBggHLMX7abWiSK: email,
  fldJkDrwa6kc0IJnA: titles.map(n => ({ name: n })), fldcHPqfxScpuUbZ6: { name: active ? 'Active' : 'Inactive' }, ...(role ? { fldWRmtEbJ6tfyLX1: { name: role } } : {}) } });
const FL = (id, unit, status, series, make, model, desig, depot) => ({ id, fields: { fldVL7P5cZaQO0lLM: unit, fldY6lnC7p63eInFV: { name: status },
  fldFia5obvtL7hNha: { name: series }, fldZL42bqcSC2Rrfx: { name: make }, fld9h45yBxzvONcW9: model, fldTGKBaLbEt97Ih6: { name: desig }, fld5A4dbfBx90FUGw: { name: depot } } });
function reset(mode) {
  DB = { ac: [], sw: [{ id: 'recSWACaaaaaaaaaa', fields: { fldTBJ7i26yh7QLez: 'Areas of concern email', fld6HLkbk1mKMq46D: { name: mode || 'Everyone' } } }],
    fleet: [FL('recF1', '2210-44', 'Active', '10', 'Chevy', 'Silverado', 'West Patroller', 'Oromocto'), FL('recF2', '1621-50', 'Active', '21', 'Volvo', '', 'D13 U-Body', 'Bagdad'),
            FL('recF3', '1410-23', 'Retired', '10', 'Chevy', '', 'West Patroller', 'Oromocto')],
    emp: [EMP('recE1', 'Troy Johnston', 'troy@x.ca', ['Quality Manager'], true, 'Owner'),
          EMP('recE2', 'Derek Melanson', 'derek@x.ca', ['Area Manager'], true),
          EMP('recE3', 'Gen Manager', 'gm@x.ca', ['General / Facility Manager'], true),
          EMP('recE4', 'Safe Manager', 'safety@x.ca', ['Safety / Training Manager'], true),
          EMP('recE5', 'Ops Manager', 'ops@x.ca', ['Operations Manager'], true),
          EMP('recE6', 'Tom Gibson', 'tom@x.ca', ['Patroller - Full Time'], true),
          EMP('recE9', 'James Rodey', 'james@x.ca', ['Patroller - Winter'], false),
          EMP('recE10', 'Op Erator', 'op@x.ca', ['Supervisor / Operator'], true),
          EMP('recE7', 'Old Manager', 'old@x.ca', ['Area Manager'], false),
          EMP('recE8', 'No Mail', 'not-an-email', ['Area Manager'], true)],
    dl: [] };
  CALLS = []; MAIL = []; seq = 0; MAIL_FAIL = false;
}
const T = { tbljQKCdR9P6DsYiL: 'ac', tblNiXX7E11K4Gfzy: 'fleet', tbltvyYslcnGUGndD: 'sw', tblUfWrGjHTHXszos: 'emp', tblGXm5nDaxGppjVj: 'dl' };
async function airtable(p, opts = {}) {
  const u = String(p), method = opts.method || 'GET';
  CALLS.push({ u, method, body: opts.body ? JSON.parse(opts.body) : null });
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
  return { records: JSON.parse(JSON.stringify(rows)) };   // every row, whatever the formula: the handler must re-check
}
require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: Object.assign({}, realLib, {
  airtable,
  sendMailDetailed: async m => { if (MAIL_FAIL) throw new Error('Resend down'); MAIL.push(m); return { sent: m.to, reason: '' }; },
  getPatrollers: async () => [{ name: 'Tom Gibson' }, { name: 'James Rodey' }],
}) };

let session = null;
global.fetch = async url => {
  if (/\/api\/session/.test(String(url))) return session ? { ok: true, status: 200, json: async () => session } : { ok: false, status: 401, json: async () => ({ ok: false }) };
  throw new Error('unexpected fetch ' + url);
};
const S = (name, orgRole = 'Employee', appRole = 'User') => ({ ok: true, allowed: true, appRole, apps: ['Patrol'], user: { name, role: orgRole, source: 'employee', employeeId: 'recX' } });
const handler = require(path.join(__dirname, '..', 'api', 'concerns.js'));
const X = handler.__test, F = X.F;
async function call(method, query, body) {
  const req = { method, query: query || {}, body, headers: { cookie: 'htra_session=abc', origin: 'https://www.mrdc-htra.com' } };
  let code = 0, out = null;
  const res = { setHeader() {}, status(c) { code = c; return this; }, json(o) { out = o; return this; }, end() { return this; } };
  await handler(req, res);
  return { code, body: out };
}
const caller = { name: 'Tom Gibson', isAdmin: false };
const NOW = new Date('2027-01-20T05:25:00Z');
const GOOD = { depot: 'Bagdad', route: 'Route 2', direction: 'EB', fromKm: '362.44', toKm: '364', description: 'Drifting across both lanes at the open fields' };

(async () => {
  /* 1 — the rules */
  let c = X.cleanConcern(GOOD, caller, NOW);
  ok('a good concern is accepted', !c.error, c.error);
  eq('…Open, Bagdad (the depot the old form lost), km to 0.1', [c.fields[F.status], c.fields[F.depot], c.fields[F.fromKm], c.fields[F.toKm]], ['Open', 'Bagdad', 362.4, 364]);
  eq('…the author and time are recorded (the old form had neither)', [c.fields[F.reportedBy], c.fields[F.observedAt]], ['Tom Gibson', NOW.toISOString()]);
  ok('…an id in Atlantic time', /^AC-20270120-0125-[A-Z0-9]{4}$/.test(c.fields[F.id]), c.fields[F.id]);
  ok('a single point: no "to" km', X.cleanConcern({ ...GOOD, toKm: '' }, caller, NOW).fields[F.toKm] === undefined);
  const err = b => (X.cleanConcern(b, caller, NOW).error || '');
  ok('no depot is refused', /Which depot/.test(err({ ...GOOD, depot: 'Bagda' })));
  ok('no route is refused', /route/.test(err({ ...GOOD, route: '' })));
  ok('"Both" is a direction; anything else is refused', !err({ ...GOOD, direction: 'Both' }) && /direction/.test(err({ ...GOOD, direction: 'NB' })));
  ok('no km is refused', /KM/.test(err({ ...GOOD, fromKm: '' })));
  ok('a bad "to" km is refused', /"to" KM/.test(err({ ...GOOD, toKm: 'abc' })));
  ok('no description is refused', /Describe/.test(err({ ...GOOD, description: '  ' })));
  ok('half a GPS fix is refused', /GPS/.test(err({ ...GOOD, lng: -65.2 })));
  const ac = { observedAt: NOW.toISOString() };
  ok('resolving needs a note', /Say what was done/.test(X.cleanResolve({ notes: '' }, ac, caller, NOW).error || ''));
  ok('resolving before it was reported is refused', /before it was reported/.test(X.cleanResolve({ notes: 'plowed', at: new Date(NOW.getTime() - 3600000).toISOString() }, ac, caller, NOW).error || ''));
  eq('a resolve: who, when, the note', (f => [f[F.status], f[F.resolvedBy], f[F.resolution]])(X.cleanResolve({ notes: 'Snow fence up' }, ac, caller, NOW).fields), ['Resolved', 'Tom Gibson', 'Snow fence up']);
  eq('where reads naturally', [X.where({ route: 'Route 2', direction: 'EB', fromKm: 362.4, toKm: 364 }), X.where({ route: 'Route 7', direction: 'Both', fromKm: 12, toKm: null })],
    ['Route 2 EB km 362.4–364.0', 'Route 7 both directions km 12.0']);

  /* 2 — who gets the email */
  reset();
  const C = require(path.join(__dirname, '..', 'api', '_conditions.js'));
  let dir = await C.directory();
  eq('fallback: active Area Managers and the Operations Manager', X.recipients(dir).sort(), ['derek@x.ca', 'ops@x.ca']);
  DB.dl.push({ id: 'recDL1', fields: { fldc22IrOlNLqIEKo: 'Bagdad depot', flderIfr2j2OpQbc1: 'bagdad@x.ca', fldbJ8Qy4QHhBrTzm: [{ name: 'Areas of Concern' }], fldshxalFiAb8egad: { name: 'Active' } } });
  dir = await C.directory();
  eq('a subscribed distribution list (a depot mailbox) replaces the fallback', X.recipients(dir), ['bagdad@x.ca']);

  /* 3 — the endpoint */
  reset('Everyone');
  session = null;
  eq('signed out: 401', (await call('GET', {})).code, 401);
  session = S('Tom Gibson');
  eq('meta: depots, routes, directions', (b => [b.depots, b.directions])((await call('GET', { meta: '1' })).body), [['Oromocto', 'Bagdad', 'River Glade'], ['EB', 'WB', 'Both']]);
  let r = await call('POST', {}, GOOD);
  eq('raise: 201, Open, emailed', [r.code, r.body.concern.status, r.body.email && r.body.email.sent], [201, 'Open', 2]);
  ok('…the subject names where and the depot', MAIL[0] && /^Area of concern — Route 2 EB km 362\.4–364\.0 \(Bagdad\)$/.test(MAIL[0].subject), MAIL[0] && MAIL[0].subject);
  ok('…recorded on the concern', /^Reported .*: /.test(DB.ac[0].fields[F.emailedTo]));
  const id = r.body.concern.id;
  r = await call('GET', {});
  eq('it is on the open list', [r.body.open.map(a => a.id), r.body.recent.length], [[id], 0]);
  MAIL = [];
  eq('resolve without a note: 400', (await call('POST', { id, action: 'resolve' }, {})).code, 400);
  r = await call('POST', { id, action: 'resolve' }, { notes: 'Snow fence installed' });
  eq('resolve: 200, Resolved, no email', [r.code, r.body.concern.status, r.body.concern.resolution, MAIL.length], [200, 'Resolved', 'Snow fence installed', 0]);
  eq('…a second resolve: 409', (await call('POST', { id, action: 'resolve' }, { notes: 'again' })).code, 409);
  r = await call('GET', {});
  eq('…off the open list, into recent', [r.body.open.length, r.body.recent.map(a => a.id)], [0, [id]]);
  eq('a bad id: 400', (await call('POST', { id: 'x', action: 'resolve' }, { notes: 'x' })).code, 400);
  reset('Owner test'); session = S('Tom Gibson');
  r = await call('POST', {}, GOOD);
  eq('Owner test: only the Owner, marked [TEST]', [MAIL.length, MAIL[0] && MAIL[0].to, MAIL[0] && /^\[TEST\]/.test(MAIL[0].subject)], [1, ['troy@x.ca'], true]);
  reset('Everyone'); session = S('Tom Gibson'); MAIL_FAIL = true;
  r = await call('POST', {}, GOOD);
  ok('mail down: the concern is still saved', r.code === 201 && DB.ac.length === 1 && /email did not go/.test(r.body.emailError), JSON.stringify(r.body));

  console.log(failures.map(f => '   FAIL  ' + f).join('\n'));
  console.log(`\n  test-concerns: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
