// test-patrol-choices.js — run with an ABSOLUTE path:
//   node <repo>/road-patrol-api/_tests/test-patrol-choices.js
// Zero dependencies; no browser needed.
//
// Why this exists: the route and precipitation pick-lists in patrol.js are the ONLY
// definition of what the daily-report form offers — the page renders whatever
// ?meta=1 hands it and holds no list of its own. Until 2026-09-02 nothing asserted
// them, so "Burton Subdivision" sat in the live Oromocto list for weeks after the
// contract it belonged to had ended.
//
// It also pins the season boundary (winter = 15 Oct → 30 Apr), which lives in the
// PAGE. That function is pulled out of the HTML and exercised directly; if it can
// no longer be found the suite FAILS rather than quietly skipping, because a
// silently-skipped test is the thing that lets a rule rot.

const path = require('path');
const fs = require('fs');
const Module = require('module');

const API  = path.join(__dirname, '..', 'api', 'patrol.js');
const PAGE = process.env.PATROL_PAGE ||
  path.join(__dirname, '..', '..', 'mrdchtra-web', 'patrol', 'daily-report.html');

// patrol.js requires ./_lib at load; stub it so the pick-lists can be read without
// credentials or a network. Only the names patrol.js destructures are needed.
const libPath = path.join(__dirname, '..', 'api', '_lib.js');
require.cache[libPath] = {
  id: libPath, filename: libPath, loaded: true, exports: {
    arr: x => (Array.isArray(x) ? x : x == null ? [] : [x]),
    sel: x => (x && x.name) || x || '',
    num: x => (x === '' || x == null ? undefined : Number(x)),
    airtable: async () => { throw new Error('airtable() must not be called from this suite'); },
    cors: () => {}, getEmployees: async () => [], getPatrollers: async () => [],
    uploadAttachment: async () => '', sendMail: async () => {}, sendMailDetailed: async () => ({}),
  },
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (req === './_lib') return libPath;
  return origResolve.call(this, req, ...rest);
};

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, x) => { if (c) pass++; else { fail++; failures.push(n + (x ? ` — ${x}` : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w),
  `got ${JSON.stringify(g)} want ${JSON.stringify(w)}`);

const T = require(API).__test;
ok('the test hook survived the module.exports assignment', !!T,
   'patrol.js exported no __test — check it is assigned AFTER module.exports = handler');
if (!T) { console.log('\n0 passed, 1 failed\n  ✗ no __test hook'); process.exit(1); }

// ── the routes ──────────────────────────────────────────────────────────────
eq('summer routes', T.SUMMER_ROUTES,
   ['Oromocto East', 'Oromocto West', 'River Glade East', 'River Glade West']);
eq('winter western routes (Oromocto depot)', T.WINTER_WESTERN,
   ['Oromocto East', 'Oromocto West', 'Mazerolle', 'Route 7']);
eq('winter eastern routes (Bagdad / River Glade)', T.WINTER_EASTERN,
   ['Bagdad East', 'Bagdad West', 'River Glade East', 'River Glade West']);

// Burton Subdivision was a short-term contract, not OMM work. It must not be
// offerable anywhere, in any season, through any of the derived lists.
const everywhere = JSON.stringify([T.SUMMER_ROUTES, T.WINTER_WESTERN, T.WINTER_EASTERN,
                                   T.ALL_ROUTES, T.CHOICES]);
ok('Burton Subdivision is gone from every list', !/burton/i.test(everywhere));
ok('and from routesFor() in both winter depots',
   !/burton/i.test(JSON.stringify([T.routesFor('Winter', 'Oromocto'),
                                   T.routesFor('Winter', 'Bagdad'),
                                   T.routesFor('Winter', 'River Glade'),
                                   T.routesFor('Summer', '')])));

// Mazerolle is a plow route Oromocto patrols. It is ALSO a depot in the Employees
// directory — vehicle and storage, plow operators, no patrollers — which is why it
// is not a depot here. Removing it as a route would be "fixing" one into the other.
ok('Mazerolle is still an Oromocto route', T.WINTER_WESTERN.includes('Mazerolle'));
ok('Mazerolle is NOT a depot', !T.CHOICES.depots.includes('Mazerolle'),
   T.CHOICES.depots.join(' | '));
eq('the depots are the three patrollers actually leave from', T.CHOICES.depots,
   ['Oromocto', 'Bagdad', 'River Glade']);

// ── routesFor: the depot decides, not the division ──────────────────────────
eq('Oromocto depot gets the western routes', T.routesFor('Winter', 'Oromocto'), T.WINTER_WESTERN);
eq('Bagdad gets the eastern routes',        T.routesFor('Winter', 'Bagdad'),    T.WINTER_EASTERN);
eq('River Glade gets the eastern routes',   T.routesFor('Winter', 'River Glade'), T.WINTER_EASTERN);
eq('summer ignores the depot entirely',     T.routesFor('Summer', 'Oromocto'),  T.SUMMER_ROUTES);
ok('ALL_ROUTES is the union of the three lists and nothing more',
   T.ALL_ROUTES.length === new Set([...T.SUMMER_ROUTES, ...T.WINTER_WESTERN, ...T.WINTER_EASTERN]).size &&
   [...T.SUMMER_ROUTES, ...T.WINTER_WESTERN, ...T.WINTER_EASTERN].every(r => T.ALL_ROUTES.includes(r)),
   T.ALL_ROUTES.join(' | '));

// ── precipitation ───────────────────────────────────────────────────────────
eq('summer precipitation', T.precipFor('Summer'), ['None', 'Fog', 'Rain']);
eq('winter precipitation', T.precipFor('Winter'),
   ['None', 'Fog', 'Rain', 'Freezing Rain', 'Snow', 'Blowing / Drifting Snow']);
ok('an unknown season falls to the WIDER winter list, never the narrower one',
   T.precipFor('').length === 6);

// ── the season boundary, read out of the page ───────────────────────────────
// Winter runs 15 Oct → 15 Apr — the CONTRACTUAL window from OMM 601.2.2(b) and the
// Winter Operations Management Plan, settled by Troy on 2026-09-02. The end date was
// 30 Apr until then; these cases exist so it cannot drift back. Pulled from the HTML
// rather than reimplemented, so this tests the shipped rule and not a copy of it.
const html = fs.readFileSync(PAGE, 'utf8');
const m = html.match(/function seasonFor\s*\([\s\S]*?\n\}/);
ok('seasonFor() can still be found in the page', !!m,
   'the regex no longer matches — find it and fix this test, do not delete it');
if (m) {
  const seasonFor = new Function('return (' + m[0] + ')')();
  const cases = [
    ['2026-10-14', 'Summer', 'the day before winter reporting starts'],
    ['2026-10-15', 'Winter', 'winter patrol reports start on 15 Oct — a firm date'],
    ['2026-04-15', 'Winter', 'the last day of the contractual winter period'],
    ['2026-04-16', 'Summer', 'the day after — defaults to Summer, patroller can override'],
    ['2026-04-30', 'Summer', 'late April defaults to Summer now, NOT Winter'],
    ['2026-03-31', 'Winter', 'the end of the core winter season'],
    ['2026-01-15', 'Winter', 'midwinter'],
    ['2026-07-15', 'Summer', 'midsummer'],
    ['2026-12-31', 'Winter', 'new year’s eve'],
    ['2026-10-01', 'Summer', 'early October is still summer'],
  ];
  cases.forEach(([d, want, why]) => eq(`season ${d} — ${why}`, seasonFor(d), want));

  // The override is the half that makes the contractual default safe: winter work
  // running past 15 April must still be filable as a winter report. Both buttons are
  // rendered unconditionally and SEASON_TOUCHED stops a later date change from
  // flipping a hand-picked season back, so the date never traps the patroller.
  // NOTE: this suite is deliberately dependency-free, so these are checks on the
  // markup rather than on rendered behaviour. Asserting a button merely EXISTS is not
  // enough — `hidden` or `disabled` leaves it present and unusable, and that mutation
  // survived the first version of this test. So check the attributes too.
  const segHtml = (html.match(/<div class="seg" id="seg-season">[\s\S]*?<\/div>/) || [''])[0];
  const seasonBtn = v => (segHtml.match(new RegExp('<button[^>]*data-v="' + v + '"[^>]*>')) || [''])[0];
  ['Winter', 'Summer'].forEach(function (v) {
    const b = seasonBtn(v);
    ok(`the ${v} button exists regardless of date`, !!b, segHtml);
    ok(`and the ${v} button is not hidden or disabled`,
       !!b && !/\b(hidden|disabled)\b/.test(b), b || '(not found)');
  });
  ok('a hand-picked season is not overwritten when the shift date changes',
     /if \(!SEASON_TOUCHED\)\s*\{\s*setSeg\('seg-season'/.test(html),
     'SEASON_TOUCHED guard not found around the date-change handler');
  ok('the hint tells the patroller the window and that they may change it',
     /15 Oct(ober)?\s*(&ndash;|–|-)\s*15 Apr/.test(html) && /change it if/.test(html));
}

// ── the seasonal rosters, driven by Job Title — added 2026-09-03 ────────────
// James Rodey, Ross Stewart, David Hayes, Brendan Annis and Jean-Guy Leaman were
// silently missing from the Daily Patrol Report's Patroller picker, in BOTH
// seasons, because WINTER_TITLES held 'Winter Patroller' where the real Employees
// Job Title is 'Patroller - Winter' — reversed. Airtable's own choice is the
// source of truth (verified via the table schema); a plausible-looking respelling
// of it is exactly the class of bug this suite exists to catch (see the header
// comment in test-training-required-for.js for the sibling bug in a different
// repo). Until now SUMMER_TITLES/WINTER_TITLES were pinned as arrays but never
// run through the actual matching logic, and getEmployees()/getPatrollers() were
// stubbed to return [] — so a typo'd title string could sit here indefinitely
// with the suite green throughout.
//
// This exercises the real getChoices() end to end against a fixture roster, by
// swapping the stub's getEmployees() for one that returns Employees-shaped rows —
// the same {name, email, depot, role, titles, apps, active} shape _lib.js's real
// getEmployees() produces.
const lib = require(libPath);
const FIXTURE_EMPLOYEES = [
  { name: 'Jeremy MacDonald', email: 'jeremy@example.com', depot: 'Oromocto', role: 'Employee',
    titles: ['Patroller - Full Time'], apps: [], active: true },
  // The exact shape of the bug: sole title is "Patroller - Winter", no App
  // Access grant to fall back on. Must appear on the winter roster and NOT on
  // the summer one.
  { name: 'James Rodey', email: 'james@example.com', depot: 'Bagdad', role: 'Employee',
    titles: ['Patroller - Winter'], apps: [], active: true },
  // Winter patrollers are marked Inactive out of season — must still appear on
  // the winter roster (that is the whole point of WINTER_TITLES keeping
  // inactive staff), but never on the summer one.
  { name: 'Ross Stewart', email: 'ross@example.com', depot: 'River Glade', role: 'Employee',
    titles: ['Patroller - Winter'], apps: [], active: false },
  // An inactive full-time patroller: winter has no active filter at all (by
  // design — see the WINTER_TITLES comment above), so they still show on the
  // winter roster; summer filters to active-only, so they must NOT show there.
  { name: 'Tom Gibson', email: 'tom@example.com', depot: 'Oromocto', role: 'Employee',
    titles: ['Patroller - Full Time'], apps: [], active: false },
  // No qualifying title or app access at all — must appear on neither roster.
  { name: 'Someone Else', email: 'else@example.com', depot: 'Oromocto', role: 'Employee',
    titles: ['Office Staff'], apps: [], active: true },
];
lib.getEmployees = async () => FIXTURE_EMPLOYEES;

(async () => {
  eq('WINTER_TITLES carries the real Job Title, not a respelling of it',
     T.WINTER_TITLES, ['Patroller - Full Time', 'Patroller - Winter']);
  ok('and never the old typo\'d value', !T.WINTER_TITLES.includes('Winter Patroller'),
     T.WINTER_TITLES.join(' | '));

  const choices = await T.getChoices();
  const names = list => list.map(p => p.name);

  eq('winter roster includes an active Patroller - Winter employee',
     names(choices.winterPatrollers).includes('James Rodey'), true);
  eq('and an INACTIVE Patroller - Winter employee too (seasonal, kept for winter)',
     names(choices.winterPatrollers).includes('Ross Stewart'), true);
  eq('winter roster keeps an inactive full-time patroller too (no active filter in winter)',
     names(choices.winterPatrollers).includes('Tom Gibson'), true);
  eq('winter roster excludes someone with no qualifying title',
     names(choices.winterPatrollers).includes('Someone Else'), false);

  eq('summer roster (active-only) includes the full-time patroller',
     names(choices.summerPatrollers).includes('Jeremy MacDonald'), true);
  eq('summer roster excludes a winter-only patroller',
     names(choices.summerPatrollers).includes('James Rodey'), false);
  eq('summer roster excludes an inactive full-time patroller (active-only filter)',
     names(choices.summerPatrollers).includes('Tom Gibson'), false);

  // ── the second, independent copy of the same typo, in _lib.js's PATROL_TITLES
  // ──────────────────────────────────────────────────────────────────────────
  // _lib.js is stubbed out above so patrol.js can load without credentials, which
  // means its real PATROL_TITLES can't be exercised through a live require the
  // way WINTER_TITLES was above. Pull it out of the actual source instead — the
  // same technique this file already uses for seasonFor() in the HTML — so this
  // tests the shipped array, not a copy of it.
  const libSrc = fs.readFileSync(libPath, 'utf8');
  const ptMatch = libSrc.match(/const PATROL_TITLES = (\[[\s\S]*?\]);/);
  ok('PATROL_TITLES can still be found in _lib.js',
     !!ptMatch, 'the regex no longer matches — find it and fix this test, do not delete it');
  if (ptMatch) {
    const PATROL_TITLES = new Function('return ' + ptMatch[1])();
    ok('_lib.js PATROL_TITLES carries the real Job Title, not a respelling of it',
       PATROL_TITLES.includes('Patroller - Winter'), PATROL_TITLES.join(' | '));
    ok('and never the old typo\'d value',
       !PATROL_TITLES.includes('Winter Patroller'), PATROL_TITLES.join(' | '));
    // getPatrollers()'s own predicate, reimplemented against the fixture — trivial
    // enough (a single .some/.includes) that this is testing the DATA, which is
    // exactly where the bug lived, not reimplementing logic worth its own bug.
    const matches = FIXTURE_EMPLOYEES.filter(e => e.active &&
      (e.titles.some(t => PATROL_TITLES.includes(t)) || e.apps.includes('Patrol') || e.role === 'Owner'));
    ok('getPatrollers()\'s title match picks up James Rodey even with no App Access fallback',
       matches.map(e => e.name).includes('James Rodey'), matches.map(e => e.name).join(' | '));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('\nFAILURES:'); failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
  process.exit(0);
})();
