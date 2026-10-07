// test-advisories.js — run with an ABSOLUTE path:
//   node <repo>/road-patrol-api/_tests/test-advisories.js
// Zero dependencies; no browser, no network, no credentials.
//
// No Travel Advisories (2026-10-07), replacing DeviceMagic "Winter - No Travel Advisory -
// ISSUED" and "- LIFTED". The point of the rebuild: ONE record per advisory, lifted on the
// same record; KM is the record; lifting needs a name; times are real.
//   1. the issue rules       2. the lift rules       3. who gets the email + the switch
//   4. the endpoint: sign-in first, list active/recent, issue, lift once, email failure never loses the record
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
  DB = { adv: [], sw: [{ id: 'recSWADVaaaaaaaaa', fields: { fldTBJ7i26yh7QLez: 'Travel advisory email', fld6HLkbk1mKMq46D: { name: mode || 'Everyone' } } }],
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
const T = { tblF6YUnUTdRF6e3K: 'adv', tbltvyYslcnGUGndD: 'sw', tblUfWrGjHTHXszos: 'emp', tblGXm5nDaxGppjVj: 'dl' };
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
const handler = require(path.join(__dirname, '..', 'api', 'advisories.js'));
const X = handler.__test;
async function call(method, query, body) {
  const req = { method, query: query || {}, body, headers: { cookie: 'htra_session=abc', origin: 'https://www.mrdc-htra.com' } };
  let code = 0, out = null;
  const res = { setHeader() {}, status(c) { code = c; return this; }, json(o) { out = o; return this; }, end() { return this; } };
  await handler(req, res);
  return { code, body: out };
}
const caller = { name: 'Tom Gibson', isAdmin: false };
const NOW = new Date('2027-01-20T05:25:00Z');            // 01:25 Atlantic
const GOOD = { routes: ['Route 2'], fromKm: '257.2', toKm: 342, reason: 'Whiteout, zero visibility', section: 'Exit 258 to Exit 339' };

(async () => {
  /* 1 — issue */
  let c = X.cleanIssue(GOOD, caller, NOW);
  ok('a good advisory is accepted', !c.error, c.error);
  eq('…Active, No Travel Advisory by default, km as numbers', [c.fields[X.A.status], c.fields[X.A.type], c.fields[X.A.fromKm], c.fields[X.A.toKm]], ['Active', 'No Travel Advisory', 257.2, 342]);
  eq('…issued now, by the signed-in user unless named', [c.fields[X.A.issuedAt], c.fields[X.A.issuedBy], c.fields[X.A.issueEnteredBy]], [NOW.toISOString(), 'Tom Gibson', 'Tom Gibson']);
  ok('…an advisory id in Atlantic time', /^NTA-20270120-0125-[A-Z0-9]{4}$/.test(c.fields[X.A.id]), c.fields[X.A.id]);
  eq('routes are kept in the form\'s order', X.cleanIssue({ ...GOOD, routes: ['Route 8', 'Route 2'] }, caller, NOW).fields[X.A.routes], ['Route 2', 'Route 8']);
  eq('the closure protocol is a type', X.cleanIssue({ ...GOOD, type: 'Highway Closed / Emergency Vehicles Only' }, caller, NOW).fields[X.A.type], 'Highway Closed / Emergency Vehicles Only');
  const err = b => (X.cleanIssue(b, caller, NOW).error || '');
  ok('no route is refused', /Pick the route/.test(err({ ...GOOD, routes: [] })));
  ok('an unknown route is refused', /Unknown route/.test(err({ ...GOOD, routes: ['Route 2', 'Route 99'] })));
  ok('an unknown type is refused', /kind of advisory/.test(err({ ...GOOD, type: 'Bad' })));
  ok('a missing km is refused', /from and to KM/.test(err({ ...GOOD, toKm: '' })));
  ok('a non-number km is refused', /from and to KM/.test(err({ ...GOOD, fromKm: 'exit 258' })));
  ok('the same km twice is refused', /same/.test(err({ ...GOOD, toKm: 257.2 })));
  ok('…from above to is fine (direction of travel)', !err({ ...GOOD, fromKm: 342, toKm: 257.2 }));
  ok('no reason is refused', /reason/.test(err({ ...GOOD, reason: ' ' })));
  ok('a time in the future is refused', /future/.test(err({ ...GOOD, issuedAt: new Date(NOW.getTime() + 3600000).toISOString() })));
  ok('more than a day back is refused', /more than a day ago/.test(err({ ...GOOD, issuedAt: new Date(NOW.getTime() - 25 * 3600000).toISOString() })));
  eq('an earlier time today is kept', X.cleanIssue({ ...GOOD, issuedAt: '2027-01-20T04:25:00Z', issuedBy: 'Derek Melanson' }, caller, NOW).fields[X.A.issuedAt], '2027-01-20T04:25:00.000Z');
  eq('…and the named issuer', X.cleanIssue({ ...GOOD, issuedBy: 'Derek Melanson' }, caller, NOW).fields[X.A.issuedBy], 'Derek Melanson');

  /* 2 — lift */
  const adv = { issuedAt: '2027-01-20T04:25:00.000Z' };
  c = X.cleanLift({}, adv, caller, NOW);
  eq('lift: Lifted, now, by the signed-in user', [c.fields[X.A.status], c.fields[X.A.liftedAt], c.fields[X.A.liftedBy]], ['Lifted', NOW.toISOString(), 'Tom Gibson']);
  ok('lifting before it was issued is refused', /before it was issued/.test(X.cleanLift({ liftedAt: '2027-01-20T04:00:00Z' }, adv, caller, NOW).error || ''));
  ok('lift time in the future is refused', /future/.test(X.cleanLift({ liftedAt: '2027-01-20T09:00:00Z' }, adv, caller, NOW).error || ''));
  ok('a nameless lift is refused', /Who lifted/.test(X.cleanLift({ liftedBy: ' ' }, adv, { name: '' }, NOW).error || ''));

  /* 3 — recipients */
  reset();
  const C = require(path.join(__dirname, '..', 'api', '_conditions.js'));
  let dir = await C.directory();
  eq('nobody subscribed: the management group by job title (active, valid email)', X.recipients(dir).sort(), ['derek@x.ca', 'gm@x.ca', 'ops@x.ca', 'safety@x.ca', 'troy@x.ca']);
  ok('…not patrollers, not inactive, not a bad address', !X.recipients(dir).some(e => ['tom@x.ca', 'old@x.ca', 'not-an-email'].includes(e)));
  DB.emp[5].fields.fldFejJ45fAYDWJlW = [{ name: 'Travel Advisories' }];
  DB.dl.push({ id: 'recD1', fields: { fldc22IrOlNLqIEKo: 'Ops centre', flderIfr2j2OpQbc1: 'occ@x.ca', fldbJ8Qy4QHhBrTzm: [{ name: 'Travel Advisories' }], fldshxalFiAb8egad: { name: 'Active' } } });
  dir = await C.directory();
  eq('once anyone subscribes: the subscribers only (people and lists)', X.recipients(dir).sort(), ['occ@x.ca', 'tom@x.ca']);

  /* 4 — the endpoint */
  reset('Everyone');
  session = null;
  eq('signed out: 401', (await call('GET', {})).code, 401);
  session = S('Tom Gibson');
  const meta = (await call('GET', { meta: '1' })).body;
  eq('meta', [meta.routes, meta.types.length, meta.me, meta.patrollers], [['Route 1', 'Route 2', 'Route 7', 'Route 8'], 2, 'Tom Gibson', ['Tom Gibson', 'James Rodey']]);
  let r = await call('POST', {}, { ...GOOD });
  eq('issue: 201, Active, emailed', [r.code, r.body.advisory.status, r.body.email.sent], [201, 'Active', 5]);
  ok('…the email says ISSUED, where, and why', MAIL[0] && /^NO TRAVEL ADVISORY ISSUED — Route 2 km 257\.2–342\.0 \(Exit 258 to Exit 339\)$/.test(MAIL[0].subject) && /Whiteout, zero visibility/.test(MAIL[0].html), MAIL[0] && MAIL[0].subject);
  ok('…and who it went to is on the record', /derek@x\.ca/.test(DB.adv[0].fields[X.A.issueEmailedTo]) && !!DB.adv[0].fields[X.A.issueEmailedAt]);
  const id = r.body.advisory.id;
  r = await call('GET', {});
  eq('the list: it is active', [r.body.active.map(a => a.id), r.body.recent.length], [[id], 0]);
  eq('a bad issue is a 400 with the reason', [(await call('POST', {}, { ...GOOD, routes: [] })).code], [400]);
  eq('an unknown action is a 400', (await call('POST', { id, action: 'delete' }, {})).code, 400);
  eq('a bad id is a 400', (await call('POST', { id: 'x', action: 'lift' }, {})).code, 400);
  session = S('Derek Melanson');
  r = await call('POST', { id, action: 'lift' }, { notes: 'Visibility back' });
  eq('lift (by someone else — the next shift): 200, same record, Lifted by them', [r.code, r.body.advisory.id, r.body.advisory.status, r.body.advisory.liftedBy], [200, id, 'Lifted', 'Derek Melanson']);
  ok('…ONE record, not two', DB.adv.length === 1);
  ok('…the lift email says LIFTED and who', MAIL[1] && /^NO TRAVEL ADVISORY LIFTED — Route 2/.test(MAIL[1].subject) && /Lifted .* by Derek Melanson/.test(MAIL[1].html) && /Visibility back/.test(MAIL[1].html), MAIL[1] && MAIL[1].subject);
  ok('…and recorded', /derek@x\.ca/.test(DB.adv[0].fields[X.A.liftEmailedTo]));
  r = await call('POST', { id, action: 'lift' }, {});
  ok('lifting twice: 409, says when and who', r.code === 409 && /Already lifted .* by Derek Melanson/.test(r.body.error), JSON.stringify(r.body));
  eq('…no third email', MAIL.length, 2);
  r = await call('GET', {});
  eq('the list: no longer active, in recent', [r.body.active.length, r.body.recent.map(a => a.id)], [0, [id]]);
  // an old lifted one is not "recent"; an old ACTIVE one still shows
  DB.adv.push({ id: 'recOLDLIFTEDaaaaa', fields: { [X.A.status]: { name: 'Lifted' }, [X.A.issuedAt]: new Date(Date.now() - 60 * 864e5).toISOString(), [X.A.routes]: [{ name: 'Route 7' }] } });
  DB.adv.push({ id: 'recOLDACTIVEaaaaa', fields: { [X.A.status]: { name: 'Active' }, [X.A.issuedAt]: new Date(Date.now() - 60 * 864e5).toISOString(), [X.A.routes]: [{ name: 'Route 8' }] } });
  r = await call('GET', {});
  ok('an old lifted advisory drops out; an old one never lifted stays active', !r.body.recent.some(a => a.id === 'recOLDLIFTEDaaaaa') && r.body.active.some(a => a.id === 'recOLDACTIVEaaaaa'), JSON.stringify(r.body).slice(0, 300));

  // Owner test / Off / mail down
  reset('Owner test'); session = S('Tom Gibson');
  r = await call('POST', {}, { ...GOOD });
  ok('Owner test: only the Owner, marked [TEST], naming who it would reach', MAIL.length === 1 && JSON.stringify(MAIL[0].to) === '["troy@x.ca"]' && /^\[TEST\] /.test(MAIL[0].subject) && /would go to 5 people/.test(MAIL[0].html));
  ok('…recorded as a test', /^Owner test: troy@x\.ca \(would go to 5\)$/.test(DB.adv[0].fields[X.A.issueEmailedTo]), DB.adv[0].fields[X.A.issueEmailedTo]);
  reset('Off'); session = S('Tom Gibson');
  r = await call('POST', {}, { ...GOOD });
  ok('Off: saved, no mail, says why', r.code === 201 && !MAIL.length && /switch is Off/.test(DB.adv[0].fields[X.A.issueEmailedTo]));
  reset('Everyone'); DB.sw = []; session = S('Tom Gibson');
  r = await call('POST', {}, { ...GOOD });
  ok('no switch row = Off', r.code === 201 && !MAIL.length);
  reset('Everyone'); MAIL_FAIL = true; session = S('Tom Gibson');
  r = await call('POST', {}, { ...GOOD });
  ok('mail down: the advisory is still saved, and it says so', r.code === 201 && DB.adv.length === 1 && /Saved, but the email did not go/.test(r.body.emailError || ''), JSON.stringify(r.body));
  r = await call('POST', { id: DB.adv[0].id, action: 'lift' }, {});
  ok('…and a lift is still saved', r.code === 200 && DB.adv[0].fields[X.A.status] === 'Lifted' && /Lifted, but the email did not go/.test(r.body.emailError || ''));

  console.log(failures.map(f => '   FAIL  ' + f).join('\n'));
  console.log(`\n  test-advisories: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
