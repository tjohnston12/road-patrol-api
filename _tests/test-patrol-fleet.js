// test-patrol-fleet.js — run with an ABSOLUTE path:
//   node <repo>/road-patrol-api/_tests/test-patrol-fleet.js
// Zero dependencies; no browser, no network, no credentials.
//
// The patrol vehicle from the fleet list (Troy, 2026-10-07). api/patrol.js:
//  1. getFleet() reads Fleet DB Inventory: ACTIVE units in the 10 series (pickups) only —
//     "patrollers only drive pickups 10 series" (Troy) — every page, fields by id, sorted by unit number; cached 10 minutes.
//  2. ?meta=1 carries it as choices.fleet, and still carries the learned `vehicles` list
//     (a spare or rental is typed).
//  3. A Fleet DB that cannot be read gives an empty list; the meta call still answers.
//  4. Saving a report stamps Vehicle Fleet Record = the matching unit's record id (dashes and
//     spaces ignored), '' for a number not on the fleet, '' when the vehicle is cleared, and
//     nothing at all when the save carries no vehicle or the fleet cannot be read.
//  5. shape() returns vehicleFleet.

const path = require('path');
const Module = require('module');
const libPath  = path.join(__dirname, '..', 'api', '_lib.js');
const authPath = path.join(__dirname, '..', 'api', '_auth.js');
const PATROL   = path.join(__dirname, '..', 'api', 'patrol.js');

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, x) => { if (c) pass++; else { fail++; failures.push(n + (x ? ` — ${x}` : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), `got ${JSON.stringify(g)} want ${JSON.stringify(w)}`);

const FV = { unit: 'fldVL7P5cZaQO0lLM', status: 'fldY6lnC7p63eInFV', series: 'fldFia5obvtL7hNha', designation: 'fldTGKBaLbEt97Ih6',
  depot: 'fld5A4dbfBx90FUGw', make: 'fldZL42bqcSC2Rrfx', model: 'fld9h45yBxzvONcW9' };
const S_ = n => ({ id: 'sel', name: n });
const unit = (id, u, st, ser, des, dep) => ({ id, fields: { [FV.unit]: u, [FV.status]: S_(st), [FV.series]: S_(ser),
  ...(des ? { [FV.designation]: S_(des) } : {}), ...(dep ? { [FV.depot]: S_(dep) } : {}), [FV.model]: 'Silverado' } });
const PAGE1 = [unit('recFLEETUNIT00010', '2210-44', 'Active', '10', 'West Patroller', 'Oromocto'),
  unit('recFLEETUNIT00002', '1910-02', 'Active', '10', 'Bagdad Patroller', 'Bagdad'),
  unit('recFLEETUNIT00099', '1410-23', 'Retired', '10', 'West Patroller', 'Oromocto'),
  unit('recFLEETUNIT00050', '5010-07', 'Active', '50', 'Spreader', 'Oromocto')];
const PAGE2 = [unit('recFLEETUNIT00021', '2121-46', 'Active', '21', 'Tandem', 'Bagdad'),
  unit('recFLEETUNIT00001', '1910-01', 'Active', '10', 'West Patroller', 'Oromocto')];

const F_VEH = 'fldRAvwQ4q1rQQnRy', F_FLEET = 'fldrRoU6PzrdVHiOm', F_STATUS_NAME = 'In progress';
let fleetCalls = [], fleetDown = false, writes = [], record = null;
const airtable = async (p, opt = {}) => {
  const url = new URL('https://api.airtable.com/v0/' + p);
  const m = (opt.method || 'GET').toUpperCase();
  if (url.pathname.includes('appLoRJIahB87c2Mf')) {
    fleetCalls.push(url);
    if (fleetDown) { const e = new Error('INVALID_PERMISSIONS'); e.status = 403; throw e; }
    return url.searchParams.get('offset') ? { records: PAGE2 } : { records: PAGE1, offset: 'pg2' };
  }
  if (m === 'GET' && /\/rec/.test(url.pathname)) return record;
  if (m === 'GET') return { records: url.searchParams.get('filterByFormula') ? [] : [{ id: 'recOLD', fields: { [F_VEH]: 'R-4471' } }] };
  const body = JSON.parse(opt.body); writes.push({ m, fields: body.fields });
  return { id: 'recREPORT00000001', fields: Object.assign({}, record ? record.fields : {}, body.fields) };
};
require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: {
  PAT: 'stub-pat', airtable,
  arr: x => (Array.isArray(x) ? x : x == null ? [] : [x]), sel: x => (x && x.name) || x || '',
  num: x => (x === '' || x == null ? undefined : Number(x)), esc: s => String(s == null ? '' : s),
  cors: () => false, parseBody: req => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})),
  getEmployees: async () => [], getPatrollers: async () => [],
  uploadAttachment: async () => '', sendMail: async () => {}, sendMailDetailed: async () => ({}) } };
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (r, ...rest) {
  if (r === './_lib') return libPath; if (r === './_auth') return authPath;
  return origResolve.call(this, r, ...rest);
};
global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, allowed: true, appRole: 'User', apps: ['Patrol'],
  user: { name: 'Pat Roller', email: 'p@mrdc.ca', role: 'Owner', source: 'employee', employeeId: 'recEmp1' } }) });

const patrol = require(PATROL);
const T = patrol.__test;
const call = async (method, body, query) => { const res = { code: 0, body: null, headers: {} };
  res.status = c => { res.code = c; return res; }; res.json = b => { res.body = b; return res; }; res.end = () => res; res.setHeader = () => {};
  await patrol({ method, query: query || {}, body, headers: { cookie: 'htra_session=abc' } }, res); return res; };
const lastFields = () => (writes[writes.length - 1] || {}).fields || {};

(async () => {
  try {
    /* 1 */
    T.resetFleetCache(); fleetCalls = [];
    const list = await T.getFleet();
    eq('active 10-series pickups only (no tandem, no attachment, no retired), both pages, sorted', list.map(u => u.unit), ['1910-01', '1910-02', '2210-44']);
    eq('…the series list is pickups only', T.PATROL_SERIES, ['10']);
    eq('…shaped for the form', list[2], { unit: '2210-44', recId: 'recFLEETUNIT00010', series: '10', designation: 'West Patroller', depot: 'Oromocto', make: '', model: 'Silverado' });
    ok('…asked for Active, by field id, and followed the offset', fleetCalls.length === 2 && fleetCalls[0].searchParams.get('filterByFormula') === "{Active / Retired}='Active'"
       && fleetCalls[0].searchParams.get('returnFieldsByFieldId') === 'true' && fleetCalls[0].searchParams.getAll('fields[]').includes(FV.designation)
       && fleetCalls[1].searchParams.get('offset') === 'pg2', fleetCalls.map(String).join(' '));
    ok('…from Fleet DB Inventory', fleetCalls[0].pathname.endsWith('/appLoRJIahB87c2Mf/tblNiXX7E11K4Gfzy'), fleetCalls[0].pathname);
    await T.getFleet();
    eq('cached: a second read within 10 minutes asks nobody', fleetCalls.length, 2);
    /* 2 */
    const r = await call('GET', null, { meta: '1' });
    eq('meta carries the fleet list', [r.code, (r.body.choices.fleet || []).length], [200, 3]);
    eq('…and still the learned list (spares, rentals)', r.body.choices.vehicles, ['R-4471']);
    /* 3 */
    T.resetFleetCache(); fleetDown = true;
    const r2 = await call('GET', null, { meta: '1' });
    eq('Fleet DB unreadable: empty list, meta still answers', [r2.code, r2.body.choices.fleet], [200, []]);
    eq('…and says why, without data', r2.body.choices.fleetNote, 'Fleet DB could not be read (403): INVALID_PERMISSIONS');
    ok('a readable fleet carries no note', !('fleetNote' in r.body.choices), JSON.stringify(Object.keys(r.body.choices)));
    /* 4 — stamping */
    writes = [];
    await call('POST', { draft: true, reportId: 'RP-1', patroller: 'Pat Roller', vehicle: '2210-44' });
    ok('fleet unreadable: the report saves, no stamp written', writes.length === 1 && !(F_FLEET in lastFields()) && lastFields()[F_VEH] === '2210-44', JSON.stringify(lastFields()));
    fleetDown = false; T.resetFleetCache();
    await call('POST', { draft: true, reportId: 'RP-2', patroller: 'Pat Roller', vehicle: ' 2210 44 ' });
    eq('a new report: the matching unit\'s record id is stamped (spaces/dashes ignored)', lastFields()[F_FLEET], 'recFLEETUNIT00010');
    await call('POST', { draft: true, reportId: 'RP-3', patroller: 'Pat Roller', vehicle: 'R-4471' });
    eq('a rental / unit not on the fleet: stamped blank', lastFields()[F_FLEET], '');
    await call('POST', { draft: true, reportId: 'RP-4', patroller: 'Pat Roller', vehicle: '5010-07' });
    eq('an attachment (not a pickup) is not a match', lastFields()[F_FLEET], '');
    await call('POST', { draft: true, reportId: 'RP-5', patroller: 'Pat Roller', vehicle: '2121-46' });
    eq('an active tandem (21 series) is not a match either', lastFields()[F_FLEET], '');
    record = { id: 'recREPORT00000001', fields: { 'fldiGRzVKk5PLA1y6': 'x', [F_VEH]: '2210-44', [F_FLEET]: 'recFLEETUNIT00010' } };
    record.fields[T.F.status] = F_STATUS_NAME; record.fields[T.F.patroller] = 'Pat Roller';
    await call('PATCH', { id: 'recREPORT00000001', vehicle: '1910-01' });
    eq('saving the open report with another truck re-stamps it', lastFields()[F_FLEET], 'recFLEETUNIT00001');
    await call('PATCH', { id: 'recREPORT00000001', comments: 'all quiet' });
    ok('a save without the vehicle leaves the stamp alone', !(F_FLEET in lastFields()), JSON.stringify(lastFields()));
    await call('PATCH', { id: 'recREPORT00000001', vehicle: '' });
    eq('clearing the vehicle clears the stamp', lastFields()[F_FLEET], '');
    /* 5 */
    eq('shape returns vehicleFleet', T.shape({ id: 'r', fields: { [F_FLEET]: 'recFLEETUNIT00002' } }).vehicleFleet, 'recFLEETUNIT00002');
    eq('normUnit', [T.normUnit(' 2210 - 44'), T.normUnit('r/44.71')], ['221044', 'R4471']);
  } catch (e) { fail++; failures.push('harness: ' + e.stack); }
  console.log(`\n  test-patrol-fleet: ${pass} passed, ${fail} failed`);
  if (fail) { failures.forEach(f => console.log('   FAIL  ' + f)); process.exitCode = 1; }
})();
