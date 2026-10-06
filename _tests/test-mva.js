// test-mva.js — run with an ABSOLUTE path:
//   node <repo>/road-patrol-api/_tests/test-mva.js
// Zero dependencies; no browser, no network, no credentials.
//
// POST /api/mva — the MVA Notification. Written 2026-10-06 after Troy's first
// live test MVA (2026-10-06-303.000-EB):
//   1. The notification email went out with the subject "MVA" and an empty
//      body. The create call did not ask Airtable for field IDs, Airtable
//      answered by field NAME, and shape() — which reads by ID — saw nothing.
//      The page's success screen showed a blank MVA No. for the same reason.
//      The fake Airtable below answers by NAME unless returnFieldsByFieldId is
//      sent, exactly like the real one, so the bug cannot come back unseen.
//   2. Troy: "the patroller should get the email, they need to build and
//      complete the accident file folder". The patroller is copied — address
//      from the Employees directory by name, never from the request — and the
//      email lists the folder when an accident report is required.

const path = require('path');
const Module = require('module');

const libPath  = path.join(__dirname, '..', 'api', '_lib.js');
const authPath = path.join(__dirname, '..', 'api', '_auth.js');
const MVA      = path.join(__dirname, '..', 'api', 'mva.js');

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, x) => { if (c) pass++; else { fail++; failures.push(n + (x ? ` — ${x}` : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), `got ${JSON.stringify(g)} want ${JSON.stringify(w)}`);

// Field id -> name, for the fields this exercises (from the live schema).
const NAMES = {
  flddJ5v5jZ9rv4VWg: 'MVA No.', fldyNaXuFj9LTbelQ: 'Occurred At', fld8dDEK0xlJqPUzS: 'Date',
  fld52QNBDHZQfx5za: 'Patroller', fldlCV1Cyknry8KQf: 'Patroller Email', fldgIA9dpSAllebrF: 'Division',
  fldCbe3KQ2xm7Dgs3: 'Route', fld6p5ivQNf8K0BSV: 'KM', fldypZa9PK1hyT6OU: 'Direction',
  fld9iwXIi9fetqCjI: 'Damages to Facility', fldFKDBopABcL4M6B: 'Damage Description',
  fldDZGvitTgzAtNcX: 'Highway Blocked', fld75MhzYB29Rhmqw: 'Spill', fldrqnH2ujA493AGT: 'Dept of Environment Called',
  fldNRjvZEFolYv9uq: 'Status', fldCFjoigjFgQwuv5: 'Notification Sent At', fld2uqP1UINkICedW: 'Notified',
  fldCZCNzveE8f62gi: 'Accident Report Required', fldd0JXy6NKliOKAd: 'Investigation Required',
  fldWIW6ejsJGjrMCM: 'Hit & Run', fld2h81Yn4jpfQUAz: 'Fatality', fldP4p8salI5YRkwU: 'Extensive Traffic Control',
  fldQBjjZNYPVpUaaW: 'Summary',
};
const SELECTS = ['fldgIA9dpSAllebrF', 'fldCbe3KQ2xm7Dgs3', 'fldypZa9PK1hyT6OU', 'fldNRjvZEFolYv9uq'];

let DB = {}, writes = [], mails = [], DIR = [], seq = 0;
function answer(rec, byId) {
  const f = Object.assign({}, rec.fields);
  f.fldCZCNzveE8f62gi = (f.fld9iwXIi9fetqCjI || f.fld2h81Yn4jpfQUAz || f.fldP4p8salI5YRkwU) ? 'Yes' : 'No';
  f.fldd0JXy6NKliOKAd = f.fldWIW6ejsJGjrMCM ? 'Yes' : 'No';
  for (const k of SELECTS) if (typeof f[k] === 'string') f[k] = { id: 'sel' + k, name: f[k] };
  const out = {};
  for (const [k, v] of Object.entries(f)) out[byId ? k : (NAMES[k] || k)] = v;
  return { id: rec.id, createdTime: '2026-10-06T16:58:20.000Z', fields: out };
}
const airtable = async (p, opt = {}) => {
  const url = new URL('https://api.airtable.com/v0/' + p);
  const body = opt.body ? JSON.parse(opt.body) : null;
  const byId = url.searchParams.get('returnFieldsByFieldId') === 'true' || !!(body && body.returnFieldsByFieldId);
  const m = (opt.method || 'GET').toUpperCase();
  const id = url.pathname.split('/')[4];
  if (m === 'GET' && !id) return { records: [] };                      // uniqueMvaNo: no clash
  if (m === 'POST') { writes.push({ m, byId }); const rec = { id: 'recM' + (++seq), fields: body.fields }; DB[rec.id] = rec; return answer(rec, byId); }
  if (m === 'PATCH') { writes.push({ m, byId, fields: Object.keys(body.fields) }); Object.assign(DB[id].fields, body.fields); return answer(DB[id], byId); }
  if (m === 'GET') return answer(DB[id], byId);
  throw new Error('unexpected ' + m);
};
require.cache[libPath] = {
  id: libPath, filename: libPath, loaded: true, exports: {
    PAT: 'stub-pat', airtable,
    arr: x => (Array.isArray(x) ? x : x == null ? [] : [x]),
    sel: x => (x && x.name) || x || '',
    num: x => (x === '' || x == null ? undefined : Number(x)),
    esc: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    cors: () => false,
    parseBody: req => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})),
    getEmployees: async () => DIR, getPatrollers: async () => DIR,
    uploadAttachment: async () => '',
    sendMail: async (o) => { mails.push(o); return Array.isArray(o.to) ? o.to : String(o.to).split(','); },
    sendMailDetailed: async () => ({ sent: [], reason: '' }),
  },
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (r, ...rest) {
  if (r === './_lib') return libPath;
  if (r === './_auth') return authPath;
  return origResolve.call(this, r, ...rest);
};

let session = null;
global.fetch = async () => (session
  ? { ok: true, status: 200, json: async () => session }
  : { ok: false, status: 401, json: async () => ({ ok: false }) });
const S = (orgRole, appRole, name) => ({ ok: true, allowed: true, appRole, apps: ['Patrol'],
  user: { name, email: 'x@mrdc.ca', role: orgRole, source: 'employee', employeeId: 'recEmp1' } });

delete process.env.MVA_NOTIFY_TO;
const handler = require(MVA);
async function call(method, body, query) {
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; },
    setHeader() {}, end() { return this; } };
  await handler({ method, headers: { cookie: 'htra_session=x', origin: 'https://www.mrdc-htra.com' }, query: query || {}, body }, res);
  return { status, json };
}
const reset = () => { DB = {}; writes = []; mails = []; seq = 0; };
const BASE_MVA = { date: '2026-10-06', occurredAt: '2026-10-06T16:56:00.000Z', km: 303, direction: 'EB', route: 'Route 2',
  division: 'Western', patroller: 'Tom Gibson', vehicles: 2, damages: true, damageDesc: 'guiderail hit 10 pieces', summary: 'test entry' };

(async () => {
  session = S('Employee', 'Patroller', 'Tom Gibson');
  DIR = [{ name: 'Tom Gibson', email: 'tgibson@mrdc.ca' }, { name: 'Troy Johnston', email: 'TJohnston@mrdc.ca' }];

  /* 1 — the record reads back: the bug that sent "MVA" with an empty body */
  reset();
  let r = await call('POST', { ...BASE_MVA, patrollerEmail: 'someone@else.com' });
  eq('filed', r.status, 200);
  eq('the response carries the MVA No.', r.json.row && r.json.row.mvaNo, '2026-10-06-303.000-EB');
  ok('every Airtable write asks for field IDs', writes.length >= 2 && writes.every(w => w.byId), JSON.stringify(writes));
  const m = mails[0] || {};
  ok('the subject names the MVA', /^MVA 2026-10-06-303\.000-EB — Damages to facility$/.test(m.subject || ''), m.subject);
  ok('the body carries the number, route and km', /2026-10-06-303\.000-EB/.test(m.html) && /Route 2 · km 303\.000 · EB/.test(m.html), '');
  ok('…and the patroller and damage', /Tom Gibson/.test(m.html) && /guiderail hit 10 pieces/.test(m.html));
  ok('…and says an accident report is required', /An accident report is required/.test(m.html));

  /* 2 — the patroller gets it, from the directory */
  eq('to the Accident Group and the patroller', m.to, ['AccidentGroup2@mrdc.ca', 'tgibson@mrdc.ca']);
  ok('the address in the request is ignored', !JSON.stringify(m.to).includes('someone@else.com'));
  eq('the record keeps the directory address', DB['recM1'].fields.fldlCV1Cyknry8KQf, 'tgibson@mrdc.ca');
  eq('Notified lists both', r.json.row.notified, 'AccidentGroup2@mrdc.ca, tgibson@mrdc.ca');
  eq('the page is told two recipients', r.json.emailedTo.length, 2);

  /* 3 — the accident file folder */
  ok('the email lists the accident file folder', /Accident file folder — 2026-10-06-303\.000-EB/.test(m.html));
  for (const item of ['Accident Report', 'Accident Claim Work Summary', 'Accident photos and damages', 'Photos of the completed repairs',
                      'Traffic control sheets', 'Copy of the time sheets', 'Accident Claim Checklist'])
    ok(`…including ${item}`, m.html.includes(item));
  ok('…and names who builds it', /Tom Gibson builds and completes the folder/.test(m.html));

  reset();
  r = await call('POST', { ...BASE_MVA, damages: false, damageDesc: '', blocked: true });
  ok('no accident report needed: no folder', !/Accident file folder/.test((mails[0] || {}).html || ''));
  eq('…and the subject flags the blocked highway', (mails[0] || {}).subject, 'MVA 2026-10-06-303.000-EB — Highway blocked');

  /* 4 — names the directory does not have */
  reset();
  r = await call('POST', { ...BASE_MVA, patroller: 'Visiting Patroller' });
  eq('a name not in the directory: the group only', (mails[0] || {}).to, ['AccidentGroup2@mrdc.ca']);
  reset();
  r = await call('POST', { ...BASE_MVA, patroller: '  tom gibson ' });
  eq('the name match ignores case and spaces', (mails[0] || {}).to, ['AccidentGroup2@mrdc.ca', 'tgibson@mrdc.ca']);
  reset();
  DIR = [{ name: 'Tom Gibson', email: 'accidentgroup2@MRDC.ca' }];
  r = await call('POST', BASE_MVA);
  eq('an address already on the list is not sent twice', (mails[0] || {}).to, ['AccidentGroup2@mrdc.ca']);
  DIR = [{ name: 'Tom Gibson', email: 'tgibson@mrdc.ca' }];

  /* 5 — the spill gate still refuses before anything is written or sent */
  reset();
  r = await call('POST', { ...BASE_MVA, spill: true, doeCalled: false });
  eq('spill without Dept. of Environment: 400', r.status, 400);
  ok('…nothing written, nothing sent', !writes.length && !mails.length);

  /* 6 — a supervisor's status change reads back too */
  reset();
  r = await call('POST', BASE_MVA);
  const filedId = r.json.row.id;
  session = S('Admin', 'Admin', 'Troy Johnston');
  const before = writes.length;
  r = await call('PATCH', { id: filedId, status: 'Repairs pending' });
  eq('status change answers with the new status', r.json.row && r.json.row.status, 'Repairs pending');
  ok('…asking for field IDs', writes.slice(before).every(w => w.byId) && writes.length > before);
  eq('…and the MVA No. still reads', r.json.row && r.json.row.mvaNo, '2026-10-06-303.000-EB');

  console.log(failures.map(f => '   FAIL  ' + f).join('\n'));
  console.log(`\ntest-mva: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('HARNESS', e.stack); process.exit(1); });
