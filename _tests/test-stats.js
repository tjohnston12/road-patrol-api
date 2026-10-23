// test-stats.js — run with an ABSOLUTE path:
//   node <repo>/road-patrol-api/_tests/test-stats.js
// Zero dependencies; no browser, no network, no credentials.
//
// Patroller stats (Troy, 2026-10-23: "nothing private, everyone can see"). Pinned:
//  - served by coverage.js ?view=stats to ANY signed-in Patrol caller (not admin-only);
//    no session → 401; plain coverage stays admin-only
//  - one row per person, names matched case/space-insensitively, the directory spelling wins
//  - shifts count Submitted / Reviewed / Flagged; In progress is listed as open paperwork
//    (only from before today); hours, route patrols, night checks, late (after the next day)
//  - deficiencies: reports with Yes, rows logged, work orders raised
//  - incidents from every form; accident reports / investigations still Draft are open items
//  - out-of-range rows ignored; the range is capped at 366 days; nothing is written
'use strict';
const path = require('path');
const libPath = path.join(__dirname, '..', 'api', '_lib.js');
const realLib = require(libPath);
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, x) => { if (c) pass++; else { fail++; failures.push(n + (x !== undefined ? ` — ${String(x).slice(0, 300)}` : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), `got ${JSON.stringify(g)} want ${JSON.stringify(w)}`);

let TABLES = {}, CALLS = [];
require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: Object.assign({}, realLib, {
  airtable: async (p, o = {}) => {
    CALLS.push({ p, o });
    if ((o.method || 'GET') !== 'GET') throw new Error('stats must not write');
    const t = (p.match(/\/(tbl[A-Za-z0-9]{14})/) || [])[1];
    return { records: TABLES[t] || [] };
  },
  getEmployees: async () => [
    { name: 'Jane Doe', titles: ['Patroller - Full Time'], active: true },
    { name: 'Idle Ian', titles: ['Patroller - Winter'], active: true },
    { name: 'Gone Gus', titles: ['Patroller - Full Time'], active: false },
    { name: 'Boss Bea', titles: ['Area Manager'], active: true },
  ],
}) };
let session = null;
global.fetch = async url => {
  if (/\/api\/session/.test(String(url))) return session ? { ok: true, status: 200, json: async () => session } : { ok: false, status: 401, json: async () => ({ ok: false }) };
  throw new Error('unexpected fetch ' + url);
};
const S = (orgRole, appRole) => ({ ok: true, allowed: true, appRole, apps: ['Patrol'], user: { name: 'X', role: orgRole, source: 'employee', employeeId: 'recX' } });
const handler = require(path.join(__dirname, '..', 'api', 'coverage.js'));
const ST = require(path.join(__dirname, '..', 'api', '_stats.js'));
async function call(query) {
  const req = { method: 'GET', query: query || {}, headers: { cookie: 'htra_session=abc', origin: 'https://www.mrdc-htra.com' } };
  let code = 0, out = null;
  const res = { setHeader() {}, status(c) { code = c; return this; }, json(o) { out = o; return this; }, end() { return this; } };
  await handler(req, res);
  return { code, body: out };
}
let n = 0;
const rec = (fields, createdTime) => ({ id: 'rec' + String(++n).padStart(14, '0'), createdTime: createdTime || '2026-10-10T12:00:00.000Z', fields });
const SH = ST.SRC.shifts, f = SH.f;
const shift = (who, date, o) => rec(Object.assign({ [SH.who]: who, [SH.when]: date, [f.reportId]: 'RP-' + n, [f.shift]: 'Day', [f.status]: 'Submitted',
  [f.routes]: ['Oromocto East', 'Oromocto West'], [f.hours]: 10.5, [f.submittedAt]: date + 'T22:00:00.000Z' }, o || {}));
const by = (kind, who, when, extra) => rec(Object.assign({ [ST.SRC[kind].who]: who, [ST.SRC[kind].when]: when }, extra || {}));

(async () => {
  TABLES = {
    [SH.table]: [
      shift('Jane Doe', '2026-10-05'),
      shift('jane  doe ', '2026-10-06', { [f.shift]: 'Night', [f.illumination]: true, [f.reflectivity]: true, [f.status]: 'Reviewed', [f.hours]: 11 }),
      shift('Jane Doe', '2026-10-07', { [f.deficiencies]: true, [f.defsJson]: JSON.stringify([{ a: 1 }, { a: 2 }, { a: 3 }]), [f.defsRaised]: 2, [f.status]: 'Flagged',
        [f.submittedAt]: '2026-10-09T15:00:00.000Z' }),                                         // filed two days later → late
      shift('Jane Doe', '2026-10-08', { [f.submittedAt]: '2026-10-09T15:00:00.000Z' }),        // next day → not late
      shift('Jane Doe', '2026-10-09', { [f.status]: 'In progress' }),                          // open
      shift('Jane Doe', '2026-10-23', { [f.status]: 'In progress' }),                          // today → not open yet
      shift('Jane Doe', '2026-09-30'),                                                         // out of range
      shift('Sam Smith', '2026-10-05', { [f.illumination]: true }),                            // night check needs both
    ],
    [ST.SRC.mvas.table]: [by('mvas', 'Jane Doe', '2026-10-06'), by('mvas', 'Sam Smith', '', { [ST.SRC.mvas.when2]: '2026-10-07T03:00:00.000Z' })],
    [ST.SRC.accidents.table]: [
      by('accidents', 'Jane Doe', '2026-10-06T14:00:00.000Z', { [ST.SRC.accidents.f.status]: 'Draft', [ST.SRC.accidents.f.no]: 'AR-1', [ST.SRC.accidents.f.mva]: ['recMVA0000000001'] }),
      by('accidents', 'Jane Doe', '2026-10-07T14:00:00.000Z', { [ST.SRC.accidents.f.status]: 'Submitted' }),
      by('accidents', '', '2026-10-07T14:00:00.000Z', { [ST.SRC.accidents.who2]: 'Sam Smith', [ST.SRC.accidents.f.status]: 'Closed' }),
    ],
    [ST.SRC.investigations.table]: [by('investigations', 'Boss Bea', '2026-10-08T14:00:00.000Z', { [ST.SRC.investigations.f.status]: 'Draft', [ST.SRC.investigations.f.mva]: ['recMVA0000000002'] })],
    [ST.SRC.animals.table]: [by('animals', 'Jane Doe', '2026-10-06T14:00:00.000Z'), by('animals', 'Jane Doe', '2026-10-02T03:30:00.000Z')],  // 2nd: Oct 2 00:30 Atlantic → in range
    [ST.SRC.breakdowns.table]: [by('breakdowns', 'Sam Smith', '2026-10-06T14:00:00.000Z')],
    [ST.SRC.concerns.table]: [by('concerns', 'Jane Doe', '2026-10-01T02:00:00.000Z')],   // Sep 30 23:00 Atlantic → out of range
    [ST.SRC.advisories.table]: [by('advisories', 'Jane Doe', '2026-10-06T14:00:00.000Z')],
    [ST.SRC.rwis.table]: [by('rwis', 'Sam Smith', '2026-10-06T14:00:00.000Z'), by('rwis', '', '2026-10-06T14:00:00.000Z')],
    [ST.SRC.conditions.table]: [by('conditions', 'Jane Doe', '2026-10-06T14:00:00.000Z')],
  };

  // ── access ────────────────────────────────────────────────────────────
  session = null;
  eq('no session → 401', (await call({ view: 'stats' })).code, 401);
  session = S('Employee', 'Patroller');
  eq('a patroller may NOT read plain coverage (unchanged)', (await call({ from: '2026-10-01', to: '2026-10-22' })).code, 403);
  CALLS = [];
  const r = await call({ view: 'stats', from: '2026-10-01', to: '2026-10-22' });
  eq('a patroller may read the stats', r.code, 200);
  ok('nothing written', CALLS.every(c => (c.o.method || 'GET') === 'GET'));
  ok('every source read', Object.values(ST.SRC).every(s => CALLS.some(c => c.p.includes(s.table))), CALLS.map(c => c.p.slice(0, 40)).join(' '));
  ok('shifts filtered by Shift Date', CALLS.some(c => c.p.includes(SH.table) && decodeURIComponent(c.p.replace(/\+/g, ' ')).includes("{Shift Date},'2026-10-01'")));
  ok('others pre-filtered by CREATED_TIME from the day before', CALLS.some(c => c.p.includes(ST.SRC.animals.table) && decodeURIComponent(c.p).includes("CREATED_TIME(),'2026-09-30'")));
  // a non-today run: compute with a fixed today
  const all = [];
  for (const k of Object.keys(ST.SRC)) for (const x of (TABLES[ST.SRC[k].table] || [])) all.push(ST.flatten(k, x));
  const out = ST.stats(all, '2026-10-01', '2026-10-23', '2026-10-23', [
    { name: 'Jane Doe', patroller: true }, { name: 'Idle Ian', patroller: true }, { name: 'Gone Gus', patroller: false }, { name: 'Boss Bea', patroller: false }]);
  const P = name => out.people.find(p => p.name === name);
  const j = P('Jane Doe');
  eq('names merged: "jane  doe " counts as Jane Doe', out.people.filter(p => /jane/i.test(p.name)).length, 1);
  eq('Jane: 4 shifts (In progress and out-of-range not counted)', [j.shifts, j.day, j.night], [4, 3, 1]);
  eq('Jane: hours', j.hours, 42.5);
  eq('Jane: route patrols', j.routePatrols, 8);
  eq('Jane: night checks need luminaires AND reflectivity', [j.nightChecks, P('Sam Smith').nightChecks], [1, 0]);
  eq('Jane: reviewed / flagged', [j.reviewed, j.flagged], [1, 1]);
  eq('Jane: filed late only when after the next day', j.late, 1);
  eq('Jane: deficiencies', [j.defReports, j.defRows, j.workOrders], [1, 3, 2]);
  eq('Jane: incidents', [j.mvas, j.animals, j.concerns, j.advisories, j.conditions, j.incidents], [1, 2, 0, 1, 1, 4]);
  eq('Jane: accident reports', j.accidents, 2);
  eq('Jane: open items, oldest first — the Draft accident report and the old In progress report', j.open.map(o => [o.kind, o.date]), [['Accident report', '2026-10-06'], ['Patrol report', '2026-10-09']]);
  ok('…linked', j.open[1].href.startsWith('reports.html?id=rec') && j.open[0].href === 'accident.html?mva=recMVA0000000001', JSON.stringify(j.open));
  const s = P('Sam Smith');
  eq('Sam (not in the directory) still gets a row', !!s, true);
  eq('Sam: MVA dated by Occurred At when Date is blank; accident by Started By when Patroller blank', [s.mvas, s.accidents, s.breakdowns, s.rwis], [1, 1, 1, 1]);
  eq('Boss Bea: investigation Draft is open', [P('Boss Bea').investigations, P('Boss Bea').openCount, P('Boss Bea').open[0].href], [1, 1, 'investigation.html?mva=recMVA0000000002']);
  eq('Idle Ian: an active patroller with nothing still listed, inactive', [!!P('Idle Ian'), P('Idle Ian').active], [true, false]);
  eq('Gone Gus: inactive and nothing filed → no row', !!P('Gone Gus'), false);
  eq('a row with no name is counted as unassigned', out.unassigned, 1);
  eq('sorted by shifts', out.people[0].name, 'Jane Doe');
  eq('team totals', [out.team.shifts, out.team.mvas, out.team.openCount, out.team.people], [5, 2, 3, 3]);

  // ── range ─────────────────────────────────────────────────────────────
  eq('from after to → 400', (await call({ view: 'stats', from: '2026-10-10', to: '2026-10-01' })).code, 400);
  eq('over 366 days → 400', (await call({ view: 'stats', from: '2025-01-01', to: '2026-10-01' })).code, 400);
  eq('a full year is fine', (await call({ view: 'stats', from: '2025-10-02', to: '2026-10-01' })).code, 200);
  eq('dayOf: Atlantic day', [ST.dayOf('2026-10-02T03:30:00.000Z'), ST.dayOf('2026-10-02'), ST.dayOf('')], ['2026-10-02', '2026-10-02', '']);

  // a failing source is reported, not fatal
  const orig = require.cache[libPath].exports.airtable;
  require.cache[libPath].exports.airtable = async (p, o) => { if (p.includes(ST.SRC.rwis.table)) throw new Error('boom'); return orig(p, o); };
  const r2 = await call({ view: 'stats', from: '2026-10-01', to: '2026-10-22' });
  eq('one source failing still answers, and names it', [r2.code, r2.body.missing], [200, ['rwis']]);
  require.cache[libPath].exports.airtable = orig;

  console.log(`test-stats: ${pass} passed, ${fail} failed`);
  failures.forEach(x => console.log('  FAIL ' + x));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('HARNESS ' + e.stack); process.exit(1); });
