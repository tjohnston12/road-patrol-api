// test-coverage.js — run with an ABSOLUTE path:
//   node <repo>/road-patrol-api/_tests/test-coverage.js
// Zero dependencies; no browser, no network, no credentials.
//
// Patrol coverage against OMM 801 (Troy, 2026-10-16). Pinned:
//  - the period rule: core winter 1 Nov–31 Mar needs a Day AND a Night patrol of every route
//    every day; summer and the two transitions need a Day patrol; the 8 winter routes apply
//    15 Oct–15 Apr, the 4 summer routes otherwise
//  - a route on a report counts for both directions (Troy's choice)
//  - only Submitted / Reviewed / Flagged count; In progress shows as in progress
//  - today is pending, the future is not judged, and neither counts in the percentages
//  - the weekly night check needs a Night report with luminaires + reflectivity (and pavement
//    markings in core winter)
//  - the endpoint is supervisors/admins only and caps the range
'use strict';
const path = require('path');
const libPath = path.join(__dirname, '..', 'api', '_lib.js');
const realLib = require(libPath);
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, x) => { if (c) pass++; else { fail++; failures.push(n + (x !== undefined ? ` — ${String(x).slice(0, 300)}` : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), `got ${JSON.stringify(g)} want ${JSON.stringify(w)}`);

let ROWS = [], CALLS = [];
require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: Object.assign({}, realLib, {
  airtable: async (p, o = {}) => { CALLS.push({ p, o }); if ((o.method || 'GET') !== 'GET') throw new Error('coverage must not write'); return { records: ROWS }; },
}) };
let session = null;
global.fetch = async url => {
  if (/\/api\/session/.test(String(url))) return session ? { ok: true, status: 200, json: async () => session } : { ok: false, status: 401, json: async () => ({ ok: false }) };
  throw new Error('unexpected fetch ' + url);
};
const S = (orgRole, appRole) => ({ ok: true, allowed: true, appRole, apps: ['Patrol'], user: { name: 'X', role: orgRole, source: 'employee', employeeId: 'recX' } });
const handler = require(path.join(__dirname, '..', 'api', 'coverage.js'));
const { coverage, periodFor, requirementFor, SUMMER_ROUTES, WINTER_ROUTES } = handler.lib;
async function call(query) {
  const req = { method: 'GET', query: query || {}, headers: { cookie: 'htra_session=abc', origin: 'https://www.mrdc-htra.com' } };
  let code = 0, out = null;
  const res = { setHeader() {}, status(c) { code = c; return this; }, json(o) { out = o; return this; }, end() { return this; } };
  await handler(req, res);
  return { code, body: out };
}
let n = 0;
const R = (date, shift, routes, o) => Object.assign({ id: 'rec' + String(++n).padStart(14, '0'), reportId: 'RP-' + n, date, shift, patroller: 'Pat', status: 'Submitted',
  routes, illumination: false, reflectivity: false, markings: false }, o || {});

(async () => {
  // ── the rule ───────────────────────────────────────────────────────────
  eq('periods', ['2026-07-01', '2026-10-15', '2026-10-31', '2026-11-01', '2027-03-31', '2027-04-01', '2027-04-15', '2027-04-16'].map(periodFor),
    ['summer', 'transition', 'transition', 'core-winter', 'core-winter', 'transition', 'transition', 'summer']);
  eq('summer: 4 routes, day only', [requirementFor('2026-07-01').routes.length, requirementFor('2026-07-01').night], [4, false]);
  eq('transition: 8 winter routes, day only', [requirementFor('2026-10-20').routes.length, requirementFor('2026-10-20').night], [8, false]);
  eq('core winter: 8 routes, day and night', [requirementFor('2027-01-10').routes.length, requirementFor('2027-01-10').night], [8, true]);
  eq('15 Apr still winter routes; 16 Apr summer', [requirementFor('2027-04-15').routes.length, requirementFor('2027-04-16').routes.length], [8, 4]);

  // ── a summer week ──────────────────────────────────────────────────────
  {
    const all = SUMMER_ROUTES;
    const reps = [
      R('2026-07-05', 'Day', all),                                           // Sun: all four
      R('2026-07-06', 'Day', ['Oromocto East', 'Oromocto West']),            // Mon: west only…
      R('2026-07-06', 'Day', ['River Glade East', 'River Glade West']),      // …and east by another patroller
      R('2026-07-07', 'Day', ['Oromocto East', 'Oromocto West', 'River Glade East']),   // Tue: RGW missing
      R('2026-07-08', 'Day', all, { status: 'In progress' }),                // Wed: still in progress
      R('2026-07-09', 'Night', all, { illumination: true, reflectivity: true }),   // Thu: night only, no day
      R('2026-07-09', 'Day', all, { status: 'Submitted' }),
    ];
    const c = coverage(reps, '2026-07-05', '2026-07-11', '2026-07-10');
    const st = Object.fromEntries(c.days.map(d => [d.date, d.state]));
    eq('day states', [st['2026-07-05'], st['2026-07-06'], st['2026-07-07'], st['2026-07-08'], st['2026-07-09'], st['2026-07-10'], st['2026-07-11']],
      ['met', 'met', 'missed', 'missed', 'met', 'today', 'future']);
    eq('Tue names what is missing', c.days[2].missing, ['River Glade West (day)']);
    eq('Wed: an in-progress report shows as in progress, not met', c.days[3].routes[0].cells.Day.state, 'in-progress');
    eq('two reports together cover a day', c.days[1].state, 'met');
    eq('summary counts only finished days', [c.summary.daysCounted, c.summary.daysMet, c.summary.pctDays], [5, 3, 60]);
    eq('slots: 5 days × 4 routes', [c.summary.slots, c.summary.slotsMet], [20, 15]);
    eq('weekly night check met by Thursday\'s night report', [c.weeks.length, c.weeks[0].state, c.weeks[0].reports.length], [1, 'met', 1]);
    eq('today with nothing filed yet is pending, not missed', c.days[5].routes[0].cells.Day.state, 'pending');
    eq('night not required in summer', c.days[0].nightRequired, false);
    ok('reports used / in progress', c.summary.reportsUsed === 6 && c.summary.inProgress === 1, JSON.stringify(c.summary));
  }

  // ── core winter ────────────────────────────────────────────────────────
  {
    const W = WINTER_ROUTES;
    const west = W.slice(0, 4), east = W.slice(4);
    const reps = [
      R('2027-01-10', 'Day', west), R('2027-01-10', 'Day', east), R('2027-01-10', 'Night', west), R('2027-01-10', 'Night', east),
      R('2027-01-11', 'Day', west), R('2027-01-11', 'Day', east), R('2027-01-11', 'Night', west),   // Eastern night missing
      R('2027-01-12', 'Night', W, { illumination: true, reflectivity: true }),                       // markings not checked
    ];
    const c = coverage(reps, '2027-01-10', '2027-01-12', '2027-01-20');
    eq('a full day and night', c.days[0].state, 'met');
    eq('Eastern night missing is named per route', c.days[1].missing, ['Bagdad East (night)', 'Bagdad West (night)', 'River Glade East (night)', 'River Glade West (night)']);
    eq('night only is not enough in core winter', c.days[2].missing.length, 8);
    eq('core-winter week needs pavement markings too — not met', [c.weeks[0].needMarkings, c.weeks[0].state], [true, 'partial']);
    const c2 = coverage(reps.concat(R('2027-01-12', 'Night', ['Mazerolle'], { illumination: true, reflectivity: true, markings: true })), '2027-01-10', '2027-01-16', '2027-01-20');
    eq('…with markings checked it is met', c2.weeks[0].state, 'met');
    eq('route by shift tallies', c.summary.byRoute.find(r => r.route === 'Bagdad East' && r.shift === 'Night'), { route: 'Bagdad East', shift: 'Night', required: 3, met: 2 });
  }

  // ── edges ──────────────────────────────────────────────────────────────
  {
    const c = coverage([R('2026-07-06', 'Day', SUMMER_ROUTES, { status: 'Draft' })], '2026-07-06', '2026-07-06', '2026-07-20');
    eq('anything but Submitted/Reviewed/Flagged/In progress is ignored', c.days[0].state, 'missed');
    const c2 = coverage([R('2026-04-20', 'Day', ['Bagdad East', ...SUMMER_ROUTES])], '2026-04-20', '2026-04-20', '2026-05-01');
    eq('a winter route on a summer date is listed as extra, not lost', [c2.days[0].state, c2.days[0].extraRoutes], ['met', ['Bagdad East']]);
    const c3 = coverage([], '2026-07-01', '2026-07-31', '2026-07-15');
    eq('a week still running is open, not missed', c3.weeks.find(w => w.start === '2026-07-12').state, 'open');
    ok('a finished full week with no night patrol is missed', c3.weeks.some(w => w.start === '2026-07-05' && w.state === 'missed'));
  }

  // ── the endpoint ───────────────────────────────────────────────────────
  {
    session = null;
    eq('signed out → 401', (await call({})).code, 401);
    session = S('Employee', 'Patroller/Supervisor');
    eq('a patroller → 403', (await call({})).code, 403);
    session = S('Employee', 'Manager');
    ROWS = [{ id: 'recAAAAAAAAAAAAAA', fields: { fldjJZKRSkgEvcR1O: '2026-07-06', fldcNyZwC9MmebOz7: { name: 'Day' }, fldn1x0NeaoDQrlcq: { name: 'Submitted' },
      fldnh3pvj0twZu5Fe: SUMMER_ROUTES.map(n => ({ name: n })), fld2yQSx8QJ3Netq3: 'Pat', fldZ4JDUx4Tqc3eQ2: 'RP-1' } },
      { id: 'recBBBBBBBBBBBBBB', fields: { fldjJZKRSkgEvcR1O: '2026-08-30', fldcNyZwC9MmebOz7: { name: 'Day' }, fldn1x0NeaoDQrlcq: { name: 'Submitted' }, fldnh3pvj0twZu5Fe: [] } }];
    const r = await call({ from: '2026-07-06', to: '2026-07-06' });
    eq('a manager gets it; the report is read from field ids', [r.code, r.body.days[0].state], [200, 'met']);
    eq('rows outside the range are ignored even if Airtable returns them', r.body.summary.reportsUsed, 1);
    ok('the query filters by date and asks by field id', /filterByFormula/.test(CALLS[CALLS.length - 1].p) && /returnFieldsByFieldId=true/.test(CALLS[CALLS.length - 1].p));
    eq('range over 93 days refused', (await call({ from: '2026-01-01', to: '2026-06-30' })).code, 400);
    eq('from after to refused', (await call({ from: '2026-07-10', to: '2026-07-01' })).code, 400);
    session = S('Owner', 'User');
    eq('the Owner (org role) gets it', (await call({ from: '2026-07-06', to: '2026-07-06' })).code, 200);
  }

  console.log(`\n  test-coverage: ${pass} passed, ${fail} failed`);
  failures.forEach(f => console.log('   FAIL ', f));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('THREW', e.stack); process.exit(1); });
