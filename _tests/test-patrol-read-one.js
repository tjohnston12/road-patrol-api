// test-patrol-read-one.js — run with an ABSOLUTE path:
//   node <repo>/road-patrol-api/_tests/test-patrol-read-one.js
// Zero dependencies; no browser, no network, no credentials.
//
// GET /api/patrol?id=<record> — one report.
// 2026-10-01, built with the supervisor view (patrol/reports.html): until then
// this route had no ownership check, so any signed-in patroller could read a
// colleague's report by its record id, while the LIST already scoped them to
// their own. Now the two agree:
//   · a supervisor/admin (isAdmin, unchanged rule) reads any report;
//   · anyone else reads a report only if it is theirs — Submitted By or
//     Patroller matches their session name (ownsRow, the rule PATCH uses);
//   · otherwise 404 "Report not found" — not 403, so a guessed id says nothing;
//   · the patroller's own resume (daily-report.html ?id=) still works.

const path = require('path');
const Module = require('module');

const libPath  = path.join(__dirname, '..', 'api', '_lib.js');
const authPath = path.join(__dirname, '..', 'api', '_auth.js');
const PATROL   = path.join(__dirname, '..', 'api', 'patrol.js');

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, x) => { if (c) pass++; else { fail++; failures.push(n + (x ? ` — ${x}` : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), `got ${JSON.stringify(g)} want ${JSON.stringify(w)}`);

const FLD_PATROLLER = 'fld2yQSx8QJ3Netq3', FLD_SUBMITTED_BY = 'fldfxE6AIHQIyhJvY';
let record = null, airtableUrls = [];
const airtable = async (url) => {
  airtableUrls.push(String(url));
  if (!record) { const e = new Error('NOT_FOUND'); e.status = 404; throw e; }
  return record;
};
require.cache[libPath] = {
  id: libPath, filename: libPath, loaded: true, exports: {
    PAT: 'stub-pat', airtable,
    arr: x => (Array.isArray(x) ? x : x == null ? [] : [x]),
    sel: x => (x && x.name) || x || '',
    num: x => (x === '' || x == null ? undefined : Number(x)),
    esc: s => String(s == null ? '' : s),
    cors: () => false,
    parseBody: req => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})),
    getEmployees: async () => [], getPatrollers: async () => [],
    uploadAttachment: async () => '', sendMail: async () => {}, sendMailDetailed: async () => ({}),
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

const patrol = require(PATROL);
const mkRes = () => { const r = { code: 0, body: null, headers: {} };
  r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; };
  r.end = () => r; r.setHeader = (k, v) => { r.headers[k] = v; }; return r; };
const get = async (id) => { const res = mkRes();
  await patrol({ method: 'GET', query: { id }, headers: { cookie: 'htra_session=abc' } }, res); return res; };

const REPORT = (patroller, submittedBy) => ({ id: 'recREPORT00000001',
  fields: { [FLD_PATROLLER]: patroller, [FLD_SUBMITTED_BY]: submittedBy } });

(async () => {
  try {
    // ── the patroller's own report ─────────────────────────────────────────
    record = REPORT('Pat Roller', 'Pat Roller');
    session = S('Employee', 'User', 'Pat Roller');
    let r = await get('recREPORT00000001');
    eq('a patroller reads their own report', r.code, 200);
    eq('  ...and gets it', r.body.row && r.body.row.patroller, 'Pat Roller');
    eq('  ...not cached', r.headers['Cache-Control'], 'no-store');

    session = S('Employee', 'User', '  pat ROLLER ');
    eq('the name match ignores case and spaces, as PATCH does', (await get('recREPORT00000001')).code, 200);

    record = REPORT('Pat Roller', 'Sam Super');
    session = S('Employee', 'User', 'Sam Super');
    eq('filed by me for someone else — Submitted By matches: readable', (await get('recREPORT00000001')).code, 200);
    session = S('Employee', 'User', 'Pat Roller');
    eq('filed for me by someone else — Patroller matches: readable', (await get('recREPORT00000001')).code, 200);

    // ── someone else's ─────────────────────────────────────────────────────
    record = REPORT('Pat Roller', 'Pat Roller');
    for (const [label, org, app] of [['plain employee', 'Employee', 'User'],
         ['Patroller/Supervisor app role (not admin today)', 'Employee', 'Patroller/Supervisor'],
         ['Manager ORG role (not admin today)', 'Manager', 'User']]) {
      session = S(org, app, 'Other Person');
      r = await get('recREPORT00000001');
      eq(`${label}: a colleague's report is 404`, r.code, 404);
      eq(`  ...says only "not found"`, r.body, { error: 'Report not found' });
    }
    session = S('Employee', 'User', '');
    eq('a session with no name owns nothing', (await get('recREPORT00000001')).code, 404);
    record = REPORT('', '');
    session = S('Employee', 'User', '');
    eq('...even a report with blank names (blank never matches blank)', (await get('recREPORT00000001')).code, 404);

    // ── supervisors and admins read any ────────────────────────────────────
    record = REPORT('Pat Roller', 'Pat Roller');
    for (const [label, org, app] of [['Owner', 'Owner', 'User'], ['Admin org role', 'Admin', 'User'],
         ['Admin app role', 'Employee', 'Admin'], ['Manager app role', 'Employee', 'Manager']]) {
      session = S(org, app, 'Sup Ervisor');
      r = await get('recREPORT00000001');
      eq(`${label} reads any report`, r.code, 200);
    }

    // ── a record that is not there is still a 404 ──────────────────────────
    record = null; session = S('Owner', 'User', 'Sup Ervisor');
    eq('an unknown id is 404 for an admin too', (await get('recNOPE')).code, 404);

    // ── the id is encoded into the Airtable path ───────────────────────────
    record = REPORT('Pat Roller', 'Pat Roller'); airtableUrls = [];
    await get('rec/../x');
    ok('the id is URL-encoded, so it cannot walk the path', airtableUrls.some(u => u.includes('rec%2F..%2Fx')), airtableUrls.join(' '));
  } catch (e) { fail++; failures.push('harness: ' + e.stack); }
  console.log(`\n  test-patrol-read-one: ${pass} passed, ${fail} failed`);
  if (fail) { failures.forEach(f => console.log('   FAIL  ' + f)); process.exitCode = 1; }
})();
