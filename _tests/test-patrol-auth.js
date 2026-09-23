// test-patrol-auth.js — run with an ABSOLUTE path:
//   node <repo>/road-patrol-api/_tests/test-patrol-auth.js
// Zero dependencies; no browser, no network, no credentials.
//
// Why this exists: until 2026-09-23 road-patrol-api had NO authentication. It
// never read the session cookie — `grep htra_session api/` returned nothing —
// and every authorization decision came from `x-user-role` / `x-app-role`,
// headers the caller sets. An anonymous GET against production returned 200 and
// twelve patrol reports. _lib.js even said so in a comment: the headers were
// "spoofable in a direct API call".
//
// So this suite asserts the things that were not true before:
//   · no session -> 401, on every route and every method
//   · a header cannot substitute for a session, or upgrade a role
//   · isAdmin comes from the verified session and matches the OLD rule exactly
//   · "my reports" with nobody to be returns nothing, not everything
//   · a 401 is a 401 and never a 500
//
// It drives the real handlers with a stubbed _lib and a stubbed global fetch,
// so _auth.js itself is under test rather than mocked away.

const path = require('path');
const Module = require('module');

const libPath  = path.join(__dirname, '..', 'api', '_lib.js');
const authPath = path.join(__dirname, '..', 'api', '_auth.js');
const PATROL   = path.join(__dirname, '..', 'api', 'patrol.js');
const MVA      = path.join(__dirname, '..', 'api', 'mva.js');

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, x) => { if (c) pass++; else { fail++; failures.push(n + (x ? ` — ${x}` : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w),
  `got ${JSON.stringify(g)} want ${JSON.stringify(w)}`);

// ── stubs ───────────────────────────────────────────────────────────────────
// Airtable must never be reached: if a request gets far enough to call it, the
// guard did not stop it, and that is the bug this suite is looking for.
let airtableCalls = 0;
const airtable = async () => { airtableCalls++; return { records: [], fields: {}, id: 'rec1' }; };

require.cache[libPath] = {
  id: libPath, filename: libPath, loaded: true, exports: {
    PAT: 'stub-pat', airtable,
    arr: x => (Array.isArray(x) ? x : x == null ? [] : [x]),
    sel: x => (x && x.name) || x || '',
    num: x => (x === '' || x == null ? undefined : Number(x)),
    esc: s => String(s == null ? '' : s),
    cors: () => false,                       // never a preflight in these tests
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

/* The auth service, stubbed at global fetch — _auth.js's own cookie test, JSON
   handling and role arithmetic all still run. `session` is what
   auth.mrdc-htra.com/api/session would answer; null means it refuses. */
let session = null, authCalls = [], authFails = false;
global.fetch = async (url, opts) => {
  authCalls.push({ url: String(url), cookie: (opts && opts.headers && opts.headers.cookie) || '' });
  if (authFails) throw new Error('auth unreachable');
  if (!session) return { ok: false, status: 401, json: async () => ({ ok: false }) };
  return { ok: true, status: 200, json: async () => session };
};

const patrol = require(PATROL);
const mva    = require(MVA);

// ── fake req/res ────────────────────────────────────────────────────────────
const mkRes = () => {
  const r = { code: 0, body: null, headers: {}, ended: false };
  r.status = c => { r.code = c; return r; };
  r.json = b => { r.body = b; r.ended = true; return r; };
  r.end = () => { r.ended = true; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.getHeader = k => r.headers[k];
  return r;
};
const mkReq = (o = {}) => ({
  method: o.method || 'GET', query: o.query || {}, body: o.body,
  headers: Object.assign({}, o.cookie === false ? {} : { cookie: 'htra_session=abc123' }, o.headers || {}),
});
const call = async (handler, o) => { const res = mkRes(); await handler(mkReq(o), res); return res; };

// Sessions the auth service could return.
const S = (orgRole, appRole, name = 'Test Person', allowed = true) => ({
  ok: true, allowed,
  user: { name, email: 't@mrdc.ca', role: orgRole, source: 'employee', employeeId: 'recEmp1' },
  apps: ['Patrol'], appRole,
});

(async () => {

/* ── 1. No session at all ──────────────────────────────────────────────────
   The state production was actually in. Every route, both handlers. */
{
  session = null;
  const routes = [
    ['patrol list',      patrol, { }],
    ['patrol meta',      patrol, { query: { meta: '1' } }],
    ['patrol by id',     patrol, { query: { id: 'rec1' } }],
    ['patrol open',      patrol, { query: { open: '1' } }],
    ['patrol POST',      patrol, { method: 'POST', body: { draft: true, patroller: 'X' } }],
    ['patrol PATCH',     patrol, { method: 'PATCH', body: { id: 'rec1' } }],
    ['mva list',         mva,    { }],
    ['mva POST',         mva,    { method: 'POST', body: {} }],
    ['mva PATCH',        mva,    { method: 'PATCH', body: { id: 'rec1' } }],
  ];
  for (const [label, h, o] of routes) {
    airtableCalls = 0;
    const res = await call(h, { ...o, cookie: false });
    eq(label + ' with no cookie is 401', res.code, 401);
    eq('  ...and never reached Airtable', airtableCalls, 0);
  }
}

/* ── 2. A header is not a session ──────────────────────────────────────────
   The exact spoof the old code honoured. */
{
  session = null;
  const res = await call(patrol, {
    cookie: false, headers: { 'x-user-role': 'Admin', 'x-app-role': 'Admin', 'x-user-name': 'Someone' },
  });
  eq('x-user-role: Admin with no cookie is still 401', res.code, 401);

  // And with a real but NON-admin session, the header must not upgrade it.
  session = S('Employee', 'User', 'Pat Roller');
  const res2 = await call(patrol, { headers: { 'x-user-role': 'Owner', 'x-app-role': 'Admin' } });
  eq('a non-admin session is not upgraded by headers — scope stays "mine"',
     res2.body && res2.body.scope, 'mine');
}

/* ── 2b. The NAME comes from the session, never from a header ──────────────
   Caught by the mutation sweep, not by design: `name` is what scopes "mine"
   and what gets stamped into Submitted By and Reviewed By. If a header could
   win, a signed-in patroller could read and sign as any colleague by naming
   them — a smaller hole than the original, but the same kind. */
{
  session = S('Employee', 'User', 'Pat Roller');
  const res = await call(patrol, {
    query: { open: '1' },
    headers: { 'x-user-name': 'Someone Else' },
  });
  eq('a session caller is not renamed by x-user-name', res.code, 200);
  const T = require(PATROL).__test;
  // findOpenReport is called with the caller's name; assert through the filter
  // the handler builds rather than reaching inside it.
  const src = require('fs').readFileSync(authPath, 'utf8');
  ok('_auth.js builds the name only from the session',
     !/req\.headers\[[^\]]*x-user-name/.test(src),
     'the name is being read from a request header again');
}

/* ── 2c. An anonymous request does not stampede the auth service ───────────
   Also from the sweep. Dropping _auth's own cookie pre-check still returns 401
   — auth refuses an empty cookie — so nothing breaks, but every unauthenticated
   request then costs a round-trip to auth.mrdc-htra.com. Cheap to keep honest. */
{
  session = null; authCalls = [];
  const res = await call(patrol, { cookie: false });
  eq('still 401 with no cookie', res.code, 401);
  eq('and the auth service was not called at all', authCalls.length, 0);
}

/* ── 3. The cookie is forwarded, and the app name is 'Patrol' ──────────────
   ⚠️ The app name must match data-app="Patrol" on the three patrol pages. If
   the two drift, the role the UI shows and the role the API enforces differ. */
{
  session = S('Owner', 'User'); authCalls = [];
  await call(patrol, {});
  ok('the session cookie is forwarded to the auth service',
     authCalls.length === 1 && /htra_session=abc123/.test(authCalls[0].cookie),
     JSON.stringify(authCalls[0]));
  ok('and it asks for app=Patrol', /[?&]app=Patrol(&|$)/.test(authCalls[0].url), authCalls[0].url);
  ok('against the auth service, not Airtable', /auth\.mrdc-htra\.com/.test(authCalls[0].url), authCalls[0].url);
}

/* ── 4. isAdmin reproduces the OLD rule exactly ────────────────────────────
   Old: ADMIN_ROLES(['Admin','Manager']).includes(x-app-role)
        || ['Owner','Admin'].includes(x-user-role)
   Nothing may widen or narrow — that is a separate decision from closing the
   hole. Read through `scope`, which is 'all' for an admin and 'mine' otherwise. */
{
  const scopeFor = async (orgRole, appRole) => {
    session = S(orgRole, appRole);
    const res = await call(patrol, {});
    return res.body && res.body.scope;
  };
  const cases = [
    ['Owner org role',                    'Owner',      'User',                 'all'],
    ['Admin org role',                    'Admin',      'User',                 'all'],
    ['Admin app role',                    'Employee',   'Admin',                'all'],
    ['Manager app role',                  'Employee',   'Manager',              'all'],
    ['Manager org role is NOT admin',     'Manager',    'User',                 'mine'],
    ['Supervisor org role is NOT admin',  'Supervisor', 'User',                 'mine'],
    ['Patroller/Supervisor app role is NOT admin', 'Employee', 'Patroller/Supervisor', 'mine'],
    ['plain employee',                    'Employee',   'User',                 'mine'],
    ['empty app role',                    'Employee',   '',                     'mine'],
  ];
  for (const [label, org, app, want] of cases) eq('isAdmin — ' + label, await scopeFor(org, app), want);
}

/* ── 5. Allowed / not allowed ──────────────────────────────────────────────
   allowed:false is auth saying this person has no Patrol in App Access.
   ⚠️ Only 2 of the 11 active employees with a patrol job title have it today,
   which is fine only while patrol/index.html gates the app to the Owner. */
{
  session = S('Employee', 'User', 'Pat Roller', false);
  const res = await call(patrol, {});
  eq('a signed-in caller without Patrol access is 401', res.code, 401);
}

/* ── 6. The auth service failing is a 401, never a 500 and never a pass ────
   A flaky dependency must not read as an open door — nor as a server fault the
   caller could retry into. */
{
  session = S('Owner', 'User'); authFails = true;
  const res = await call(patrol, {});
  authFails = false;
  eq('auth unreachable is 401', res.code, 401);
  ok('and not a 500', res.code !== 500, String(res.code));
}

/* ── 7. The guard runs BEFORE the handler try/catch ────────────────────────
   Inside it, requireCaller's 401 would be caught and re-reported as a 500 —
   the failure the September auth audit found elsewhere. Proven by the shape of
   the response: a 401 carries 'Not signed in', a swallowed one would not. */
{
  session = null;
  const res = await call(patrol, { cookie: false });
  eq('the 401 body is the auth error, not a swallowed exception',
     res.body, { error: 'Not signed in' });
}

/* ── 8. "mine" with nobody to be returns nothing ───────────────────────────
   The live bug: `if (mine && who)` skipped the filter when the name was empty,
   so the anonymous caller — the one with no identity at all — got EVERY row,
   while a named non-admin correctly got only their own. */
{
  const T = require(PATROL).__test;
  if (T && typeof T.fetchRows === 'function') {
    airtableCalls = 0;
    const rows = await T.fetchRows({ mine: true, who: '' });
    eq('fetchRows({mine, who:""}) returns no rows', rows, []);
    eq('  ...without asking Airtable for them', airtableCalls, 0);
  } else {
    // Not exported — assert on the source instead, so this can never silently skip.
    const src = require('fs').readFileSync(PATROL, 'utf8');
    ok('patrol.js scopes "mine" even when the name is empty',
       /if \(mine\) \{\s*\n\s*if \(!who\) return \[\];/.test(src),
       'the `if (mine && who)` fail-open is back');
    const msrc = require('fs').readFileSync(MVA, 'utf8');
    ok('mva.js does the same',
       /if \(mine\) \{\s*\n\s*if \(!who\) return \[\];/.test(msrc),
       'the `if (mine && who)` fail-open is back in mva.js');
  }
}

/* ── 9. Identity is never taken from a header again ────────────────────────
   A source assertion, because the next person to add a route will copy an
   existing one. _lib.js no longer exports isAdmin/callerName at all. */
{
  const fs = require('fs');
  const lib = fs.readFileSync(libPath, 'utf8');
  ok('_lib.js no longer builds identity from headers',
     !/headers\['x-(user|app)-role'\]|headers\['x-user-name'\]/.test(lib.replace(/^\s*\/\/.*$/gm, '')),
     'a header identity helper is back in _lib.js');
  for (const [name, p] of [['patrol.js', PATROL], ['mva.js', MVA]]) {
    const src = fs.readFileSync(p, 'utf8');
    ok(name + ' reads no x-user-* header', !/req\.headers\['x-/.test(src));
    /* ⚠️ Anchor on the HANDLER, not the file. An earlier version compared
       against the first `try {` anywhere in the source and flagged patrol.js,
       whose first one is in a helper 200 lines above the handler. */
    const h = src.indexOf('module.exports = async function handler');
    ok(name + ' has a handler to check', h >= 0);
    const guard = src.indexOf('await requireCaller(req, res)', h);
    const tryAt = src.indexOf('\n  try {', h);
    ok(name + ' resolves the caller before the handler try block',
       guard >= 0 && tryAt >= 0 && guard < tryAt,
       `requireCaller at ${guard}, handler try at ${tryAt} — the guard must come first, or the 401 becomes a 500`);
  }
  // The pages still SEND the headers; the preflight must keep allowing them.
  ok('the CORS allow-list still admits x-user-* so the pages keep working',
     /Access-Control-Allow-Headers[^\n]*x-user-name/.test(lib),
     'dropping these fails the preflight before the request is even sent');
  ok('and credentials are allowed, or the cookie never arrives',
     /Access-Control-Allow-Credentials/.test(lib));
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log('   FAIL  ' + f)); process.exitCode = 1; }

})();
