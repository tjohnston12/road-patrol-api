// test-animals.js — run with an ABSOLUTE path:
//   node <repo>/road-patrol-api/_tests/test-animals.js
// Zero dependencies; no browser, no network, no credentials.
//
// Animals (2026-10-07): a live sighting or road kill, one form, replacing DeviceMagic "Animal
// Sightings". Troy: road kill goes here "unless there is an mva to report". Road kill runs a
// 24-hour clock (OMM 409); deer, moose, bear and birds of prey close on the DNR call, anything
// else when MRDC buries it (EPP 4.16). A sighting inside the wildlife fence sends an email.
//   1. the report rules      2. closing road kill      3. who gets the email
//   4. counts                5. the endpoint
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
function reset(mode) {
  DB = { an: [], sw: [{ id: 'recSWANIaaaaaaaaa', fields: { fldTBJ7i26yh7QLez: 'Animal sighting email', fld6HLkbk1mKMq46D: { name: mode || 'Everyone' } } }],
    emp: [EMP('recE1', 'Troy Johnston', 'troy@x.ca', ['Quality Manager'], true, 'Owner'),
          EMP('recE2', 'Derek Melanson', 'derek@x.ca', ['Area Manager'], true),
          EMP('recE3', 'Gen Manager', 'gm@x.ca', ['General / Facility Manager'], true),
          EMP('recE4', 'Safe Manager', 'safety@x.ca', ['Safety / Training Manager'], true),
          EMP('recE5', 'Ops Manager', 'ops@x.ca', ['Operations Manager'], true),
          EMP('recE6', 'Tom Gibson', 'tom@x.ca', ['Patroller - Full Time'], true),
          EMP('recE7', 'Old Manager', 'old@x.ca', ['Area Manager'], false),
          EMP('recE8', 'No Mail', 'not-an-email', ['Area Manager'], true)],
    dl: [] };
  CALLS = []; MAIL = []; seq = 0; MAIL_FAIL = false;
}
const T = { tbl8avT8C3tPbP8n4: 'an', tbltvyYslcnGUGndD: 'sw', tblUfWrGjHTHXszos: 'emp', tblGXm5nDaxGppjVj: 'dl' };
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
const handler = require(path.join(__dirname, '..', 'api', 'animals.js'));
const X = handler.__test, F = X.F;
async function call(method, query, body) {
  const req = { method, query: query || {}, body, headers: { cookie: 'htra_session=abc', origin: 'https://www.mrdc-htra.com' } };
  let code = 0, out = null;
  const res = { setHeader() {}, status(c) { code = c; return this; }, json(o) { out = o; return this; }, end() { return this; } };
  await handler(req, res);
  return { code, body: out };
}
const caller = { name: 'Tom Gibson', isAdmin: false };
const NOW = new Date('2027-01-20T05:25:00Z');            // 01:25 Atlantic
const SEEN = { kind: 'Sighting', species: 'Moose', count: 2, route: 'Route 2', direction: 'EB', km: '312.44', ramp: '', insideFence: false };
const KILL = { kind: 'Road kill', species: 'Deer', count: 1, route: 'Route 2', direction: 'WB', km: 300 };
const KILL_SMALL = { kind: 'Road kill', species: 'Other', otherSpecies: 'Porcupine', route: 'Route 7', direction: 'EB', km: 12 };

(async () => {
  /* 1 — report rules */
  let c = X.cleanReport(SEEN, caller, NOW);
  ok('a good sighting is accepted', !c.error, c.error);
  eq('…Sighting, Recorded, Moose ×2, km rounded to 0.1', [c.fields[F.kind], c.fields[F.status], c.fields[F.species], c.fields[F.count], c.fields[F.km]], ['Sighting', 'Recorded', 'Moose', 2, 312.4]);
  eq('…seen now, by the signed-in user unless named', [c.fields[F.observedAt], c.fields[F.reportedBy], c.fields[F.enteredBy]], [NOW.toISOString(), 'Tom Gibson', 'Tom Gibson']);
  ok('…a report id in Atlantic time', /^AN-20270120-0125-[A-Z0-9]{4}$/.test(c.fields[F.id]), c.fields[F.id]);
  eq('species: Deer, Moose, Bear, Bird of prey, Other', X.SPECIES, ['Deer', 'Moose', 'Bear', 'Bird of prey', 'Other']);
  eq('DNR closes deer, moose, bear, bird of prey', X.DNR, ['Deer', 'Moose', 'Bear', 'Bird of prey']);
  c = X.cleanReport(KILL, caller, NOW);
  eq('road kill: Open, its 24-hour clock starts at discovery', [c.fields[F.kind], c.fields[F.status], c.fields[F.observedAt]], ['Road kill', 'Open', NOW.toISOString()]);
  // "unless there is an mva to report" (Troy)
  ok('road kill with an MVA to report is refused — it goes on the MVA form', /MVA form/.test(X.cleanReport({ ...KILL, mva: true }, caller, NOW).error || ''));
  ok('…a sighting is not affected by the MVA flag', !X.cleanReport({ ...SEEN, mva: true }, caller, NOW).error);
  ok('inside the fence is kept for a sighting', X.cleanReport({ ...SEEN, insideFence: true }, caller, NOW).fields[F.inside] === true);
  ok('…and never set on road kill', X.cleanReport({ ...KILL, insideFence: true }, caller, NOW).fields[F.inside] === false);
  const err = b => (X.cleanReport(b, caller, NOW).error || '');
  ok('no kind is refused', /sighting .* or road kill/.test(err({ ...SEEN, kind: '' })));
  ok('no animal is refused', /Pick the animal/.test(err({ ...SEEN, species: 'Cat' })));
  ok('Other without a name is refused', /what the animal was/.test(err({ ...SEEN, species: 'Other', otherSpecies: ' ' })));
  eq('Other keeps the name; a listed one drops stray text', [X.cleanReport({ ...SEEN, species: 'Other', otherSpecies: 'Lynx' }, caller, NOW).fields[F.other], X.cleanReport({ ...SEEN, otherSpecies: 'x' }, caller, NOW).fields[F.other]], ['Lynx', '']);
  ok('a count of 0 is refused', /How many/.test(err({ ...SEEN, count: 0 })));
  ok('a fractional count is refused', /How many/.test(err({ ...SEEN, count: 1.5 })));
  eq('no count means one', X.cleanReport({ ...SEEN, count: '' }, caller, NOW).fields[F.count], 1);
  ok('no route is refused', /Pick the route/.test(err({ ...SEEN, route: '' })));
  ok('no direction is refused', /direction/.test(err({ ...SEEN, direction: 'East Bound' })));
  ok('no km is refused', /KM/.test(err({ ...SEEN, km: '' })));
  ok('a non-number km is refused', /KM/.test(err({ ...SEEN, km: 'exit 258' })));
  eq('GPS is kept to 6 places', (f => [f[F.lat], f[F.lng]])(X.cleanReport({ ...SEEN, lat: 46.0912345, lng: -65.1234567 }, caller, NOW).fields), [46.091235, -65.123457]);
  ok('half a GPS fix is refused', /GPS/.test(err({ ...SEEN, lat: 46.1 })));
  ok('a GPS fix nowhere near NB is refused', /GPS/.test(err({ ...SEEN, lat: 0, lng: 0 })));
  ok('no GPS is fine', !err(SEEN) && X.cleanReport(SEEN, caller, NOW).fields[F.lat] === undefined);
  ok('a time in the future is refused', /future/.test(err({ ...SEEN, observedAt: new Date(NOW.getTime() + 3600000).toISOString() })));
  ok('more than a day back is refused', /more than a day ago/.test(err({ ...KILL, observedAt: new Date(NOW.getTime() - 25 * 3600000).toISOString() })));
  ok('a nameless report is refused', /Who saw it/.test(X.cleanReport({ ...SEEN, reportedBy: ' ' }, { name: '' }, NOW).error || ''));
  c = X.cleanReport({ ...KILL, closedNow: true }, caller, NOW);
  eq('road kill, DNR already called from the truck: Closed with the call', [c.fields[F.status], c.fields[F.dnrAt], c.fields[F.dnrBy], c.fields[F.removedAt]], ['Closed', NOW.toISOString(), 'Tom Gibson', undefined]);
  c = X.cleanReport({ ...KILL_SMALL, closedNow: true }, caller, NOW);
  eq('road kill, small animal already buried: Closed with the removal', [c.fields[F.status], c.fields[F.removedAt], c.fields[F.dnrAt]], ['Closed', NOW.toISOString(), undefined]);

  /* 2 — closing */
  const rep = { species: 'Moose', observedAt: '2027-01-20T04:00:00.000Z' };
  c = X.cleanClose({}, rep, caller, NOW);
  eq('close a moose: the DNR call, now, by the signed-in user', [c.fields[F.status], c.fields[F.dnrAt], c.fields[F.dnrBy]], ['Closed', NOW.toISOString(), 'Tom Gibson']);
  c = X.cleanClose({ by: 'James Rodey' }, { species: 'Other', observedAt: rep.observedAt }, caller, NOW);
  eq('close a porcupine: removed, by whoever buried it', [c.fields[F.removedAt], c.fields[F.removedBy], c.fields[F.dnrAt]], [NOW.toISOString(), 'James Rodey', undefined]);
  ok('a bird of prey is a DNR call too (its own trigger)', !!X.cleanClose({}, { species: 'Bird of prey', observedAt: rep.observedAt }, caller, NOW).fields[F.dnrAt]);
  ok('closing before it was found is refused', /before it was found/.test(X.cleanClose({ at: '2027-01-20T03:00:00Z' }, rep, caller, NOW).error || ''));
  ok('a nameless DNR call is refused', /Who called DNR/.test(X.cleanClose({ by: ' ' }, rep, { name: '' }, NOW).error || ''));

  /* 3 — recipients */
  reset();
  const C = require(path.join(__dirname, '..', 'api', '_conditions.js'));
  let dir = await C.directory();
  eq('nobody subscribed: area managers and the Operations Manager (active, valid email)', X.recipients(dir).sort(), ['derek@x.ca', 'ops@x.ca']);
  DB.emp[5].fields.fldFejJ45fAYDWJlW = [{ name: 'Animal Sightings' }];
  dir = await C.directory();
  eq('once anyone subscribes: the subscribers only', X.recipients(dir), ['tom@x.ca']);

  /* 4 — counts */
  const row = (kind, species, count, at) => ({ kind, species, count, observedAt: at });
  const cnt = X.countsFor([row('Sighting', 'Deer', 5, '2027-01-10T12:00:00Z'), row('Sighting', 'Deer', 2, '2027-01-11T12:00:00Z'),
    row('Road kill', 'Deer', 1, '2027-01-12T12:00:00Z'), row('Road kill', 'Moose', 1, '2027-01-12T12:00:00Z'),
    row('Sighting', 'Bear', 1, '2026-12-31T12:00:00Z'), row('Sighting', 'Bear', 1, '2027-01-01T03:30:00Z')], 2027);
  eq('counts are animals, not rows, split sighting / road kill', cnt.rows.filter(r => ['Deer', 'Moose'].includes(r.species)), [{ species: 'Deer', sightings: 7, roadKill: 1 }, { species: 'Moose', sightings: 0, roadKill: 1 }]);
  eq('…only this year, by Atlantic date (23:30 on 31 Dec is last year)', cnt.rows.find(r => r.species === 'Bear'), { species: 'Bear', sightings: 0, roadKill: 0 });

  /* 5 — the endpoint */
  reset('Everyone');
  session = null;
  eq('signed out: 401', (await call('GET', {})).code, 401);
  session = S('Tom Gibson');
  const meta = (await call('GET', { meta: '1' })).body;
  eq('meta', [meta.routes, meta.species, meta.dnrSpecies, meta.directions, meta.me], [['Route 1', 'Route 2', 'Route 7', 'Route 8'], X.SPECIES, X.DNR, ['EB', 'WB', 'Both'], 'Tom Gibson']);
  let r = await call('POST', {}, { ...SEEN });
  eq('sighting outside the fence: 201, recorded, no email', [r.code, r.body.report.status, r.body.email, MAIL.length], [201, 'Recorded', null, 0]);
  r = await call('POST', {}, { ...SEEN, insideFence: true, lat: 46.09, lng: -65.12, notes: 'On the shoulder' });
  eq('inside the fence: 201 and emailed', [r.code, r.body.email && r.body.email.sent], [201, 2]);
  ok('…the email names the animal, how many, where, with a map', MAIL[0] && /^Animal inside the fence — Moose ×2, Route 2 EB km 312\.4$/.test(MAIL[0].subject) && /maps\?q=46\.09,-65\.12/.test(MAIL[0].html) && /On the shoulder/.test(MAIL[0].html), MAIL[0] && MAIL[0].subject);
  ok('…and who it went to is on the record', /derek@x\.ca/.test(DB.an[1].fields[F.alertTo]) && !!DB.an[1].fields[F.alertAt]);
  r = await call('POST', {}, { ...KILL });
  eq('road kill: 201, Open, no email', [r.code, r.body.report.status, MAIL.length], [201, 'Open', 1]);
  const kid = r.body.report.id;
  ok('…due 24 hours after it was found', new Date(r.body.report.dueAt) - new Date(r.body.report.observedAt) === 24 * 3600000);
  ok('…and says DNR closes it', r.body.report.needsDnr === true);
  eq('road kill with an MVA is a 400', (await call('POST', {}, { ...KILL, mva: true })).code, 400);
  r = await call('GET', {});
  eq('the list: the deer is open; the sightings are recent', [r.body.open.map(a => a.id), r.body.recent.length], [[kid], 2]);
  ok('…counts include them', JSON.stringify(r.body.counts.rows.find(x => x.species === 'Moose')) === JSON.stringify({ species: 'Moose', sightings: 4, roadKill: 0 }) && r.body.counts.rows.find(x => x.species === 'Deer').roadKill === 1, JSON.stringify(r.body.counts));
  eq('an unknown action is a 400', (await call('POST', { id: kid, action: 'delete' }, {})).code, 400);
  eq('a bad id is a 400', (await call('POST', { id: 'x', action: 'close' }, {})).code, 400);
  eq('closing a sighting is a 400', (await call('POST', { id: DB.an[0].id, action: 'close' }, {})).code, 400);
  session = S('Derek Melanson');
  r = await call('POST', { id: kid, action: 'close' }, {});
  eq('close (by the next shift): 200, same record, DNR called by them', [r.code, r.body.report.id, r.body.report.status, r.body.report.dnrCalledBy], [200, kid, 'Closed', 'Derek Melanson']);
  r = await call('POST', { id: kid, action: 'close' }, {});
  ok('closing twice: 409, says when and who', r.code === 409 && /Already closed — DNR called .* by Derek Melanson/.test(r.body.error), JSON.stringify(r.body));
  r = await call('GET', {});
  eq('the list: nothing open; the deer is in recent', [r.body.open.length, r.body.recent.some(a => a.id === kid)], [0, true]);
  // an old closed one is not recent; an old OPEN one stays on the worklist
  DB.an.push({ id: 'recOLDCLOSEDaaaaa', fields: { [F.kind]: { name: 'Road kill' }, [F.status]: { name: 'Closed' }, [F.observedAt]: new Date(Date.now() - 60 * 864e5).toISOString() } });
  DB.an.push({ id: 'recOLDOPENaaaaaaa', fields: { [F.kind]: { name: 'Road kill' }, [F.status]: { name: 'Open' }, [F.species]: { name: 'Other' }, [F.observedAt]: new Date(Date.now() - 60 * 864e5).toISOString() } });
  r = await call('GET', {});
  ok('an old closed one drops out; an old open one stays open', !r.body.recent.some(a => a.id === 'recOLDCLOSEDaaaaa') && r.body.open.some(a => a.id === 'recOLDOPENaaaaaaa'));

  // Owner test / Off / mail down
  reset('Owner test'); session = S('Tom Gibson');
  r = await call('POST', {}, { ...SEEN, insideFence: true });
  ok('Owner test: only the Owner, marked [TEST], naming who it would reach', MAIL.length === 1 && JSON.stringify(MAIL[0].to) === '["troy@x.ca"]' && /^\[TEST\] /.test(MAIL[0].subject) && /would go to 2 people/.test(MAIL[0].html));
  reset('Off'); session = S('Tom Gibson');
  r = await call('POST', {}, { ...SEEN, insideFence: true });
  ok('Off: saved, no mail, says why', r.code === 201 && !MAIL.length && /switch is Off/.test(DB.an[0].fields[F.alertTo]));
  reset('Everyone'); DB.sw = []; session = S('Tom Gibson');
  r = await call('POST', {}, { ...SEEN, insideFence: true });
  ok('no switch row = Off', r.code === 201 && !MAIL.length);
  reset('Everyone'); MAIL_FAIL = true; session = S('Tom Gibson');
  r = await call('POST', {}, { ...SEEN, insideFence: true });
  ok('mail down: the sighting is still saved, and it says so', r.code === 201 && DB.an.length === 1 && /Saved, but the email did not go/.test(r.body.emailError || ''), JSON.stringify(r.body));

  console.log(failures.map(f => '   FAIL  ' + f).join('\n'));
  console.log(`\n  test-animals: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
