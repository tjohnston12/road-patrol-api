// test-breakdowns.js — run with an ABSOLUTE path:
//   node <repo>/road-patrol-api/_tests/test-breakdowns.js
// Zero dependencies; no browser, no network, no credentials.
//
// Breakdowns (2026-10-08): one form, two kinds — a PUBLIC vehicle broken down or abandoned, or
// MRDC EQUIPMENT (a Fleet DB unit). Each stays Open until cleared / back in service. Both email
// patrollers and management (two lists, two switches); equipment emails again when back in service.
//   1. public rules   2. equipment rules + the fleet   3. closing   4. who gets the email   5. the endpoint
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
  DB = { bd: [], sw: [{ id: 'recSWEQPaaaaaaaaa', fields: { fldTBJ7i26yh7QLez: 'Equipment breakdown email', fld6HLkbk1mKMq46D: { name: mode || 'Everyone' } } },
                    { id: 'recSWPUBaaaaaaaaa', fields: { fldTBJ7i26yh7QLez: 'Public breakdown email', fld6HLkbk1mKMq46D: { name: mode || 'Everyone' } } }],
    fleet: [FL('recF1', '1621-50', 'Active', '50', 'International', '', 'D13 U-Body', 'River Glade'), FL('recF2', '2021-48', 'Active', '20', 'Ford', 'Ford F550', 'Mechanic Truck', 'Oromocto'),
            FL('recF3', '999-01', 'Retired', '10', 'Ford', '', '', 'Oromocto')],
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
const T = { tblr5LJ7LSgXZgj36: 'bd', tblNiXX7E11K4Gfzy: 'fleet', tbltvyYslcnGUGndD: 'sw', tblUfWrGjHTHXszos: 'emp', tblGXm5nDaxGppjVj: 'dl' };
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
const handler = require(path.join(__dirname, '..', 'api', 'breakdowns.js'));
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
const PUB = { kind: 'Public vehicle', situation: 'Abandoned', position: 'Shoulder', renderedAid: 'No', vehicle: 'Grey Tucson J0G 149',
  route: 'Route 2', direction: 'WB', km: '324.64', description: 'No occupants, delineator left behind it' };
const EQ = { kind: 'MRDC equipment', unit: '1621 50', locationType: 'Yard', plowRoutes: ['River Glade East'], spareDeployed: 'Yes', spareUnit: '1521-60',
  mechanicCalled: 'Yes', towCalled: 'No', description: 'DEF issues, derated' };
const FLEET = [{ unit: '1621-50', recId: 'recF1', depot: 'River Glade', make: 'International', model: '', designation: 'D13 U-Body' }];

(async () => {
  /* 1 — public */
  let c = X.cleanReport(PUB, caller, [], NOW);
  ok('a good public breakdown is accepted', !c.error, c.error);
  eq('…Open, on the highway, km to 0.1', [c.fields[F.kind], c.fields[F.status], c.fields[F.locType], c.fields[F.km], c.fields[F.situation], c.fields[F.aid]],
    ['Public vehicle', 'Open', 'Highway', 324.6, 'Abandoned', 'No']);
  eq('…reported now, by the signed-in user unless named', [c.fields[F.observedAt], c.fields[F.reportedBy], c.fields[F.enteredBy]], [NOW.toISOString(), 'Tom Gibson', 'Tom Gibson']);
  ok('…a breakdown id in Atlantic time', /^BD-20270120-0125-[A-Z0-9]{4}$/.test(c.fields[F.id]), c.fields[F.id]);
  ok('…no equipment fields on a public vehicle', c.fields[F.unit] === undefined && c.fields[F.spare] === undefined);
  const perr = b => (X.cleanReport(b, caller, [], NOW).error || '');
  ok('no kind is refused', /public vehicle or MRDC equipment/.test(perr({ ...PUB, kind: '' })));
  ok('no situation is refused', /Broken down or abandoned/.test(perr({ ...PUB, situation: '' })));
  ok('no position is refused', /Where is it sitting/.test(perr({ ...PUB, position: 'Ditch' })));
  ok('aid unanswered is refused — not taken as a no', /render aid/.test(perr({ ...PUB, renderedAid: '' })));
  ok('no route is refused', /Pick the route/.test(perr({ ...PUB, route: '' })));
  ok('"West Bound" is refused — EB / WB only', /direction/.test(perr({ ...PUB, direction: 'West Bound' })));
  ok('no km is refused', /KM/.test(perr({ ...PUB, km: '' })));
  ok('no description is refused', /Describe what you found/.test(perr({ ...PUB, description: ' ' })));
  ok('half a GPS fix is refused', /GPS/.test(perr({ ...PUB, lat: 46.1 })));
  eq('GPS kept to 6 places', (f => [f[F.lat], f[F.lng]])(X.cleanReport({ ...PUB, lat: 46.0912345, lng: -65.1234567 }, caller, [], NOW).fields), [46.091235, -65.123457]);
  ok('a time in the future is refused', /future/.test(perr({ ...PUB, observedAt: new Date(NOW.getTime() + 3600000).toISOString() })));
  ok('more than a day back is refused', /more than a day ago/.test(perr({ ...PUB, observedAt: new Date(NOW.getTime() - 25 * 3600000).toISOString() })));

  /* 2 — equipment */
  c = X.cleanReport(EQ, caller, FLEET, NOW);
  ok('a good equipment breakdown is accepted', !c.error, c.error);
  eq('…the fleet unit: its number, record id and description, typed "1621 50" still matches',
    [c.fields[F.unit], c.fields[F.fleet], c.fields[F.unitDesc]], ['1621-50', 'recF1', 'International · D13 U-Body']);
  eq('…the depot comes from the fleet when not given', c.fields[F.depot], 'River Glade');
  eq('…in the yard: no route / km asked', [c.fields[F.locType], c.fields[F.route], c.fields[F.km]], ['Yard', undefined, undefined]);
  eq('…spare, mechanic, tow as Yes / No, and the spare unit', [c.fields[F.spare], c.fields[F.spareUnit], c.fields[F.mechanic], c.fields[F.tow]], ['Yes', '1521-60', 'Yes', 'No']);
  eq('…plow routes affected', c.fields[F.plowRoutes], ['River Glade East']);
  c = X.cleanReport({ ...EQ, unit: '7777-01', depot: 'Mazerolle' }, caller, FLEET, NOW);
  eq('a unit not in the fleet (rental) is kept as typed, no record id; Mazerolle is a depot here', [c.fields[F.unit], c.fields[F.fleet], c.fields[F.depot]], ['7777-01', '', 'Mazerolle']);
  eq('no spare: the spare unit is dropped', X.cleanReport({ ...EQ, spareDeployed: 'No' }, caller, FLEET, NOW).fields[F.spareUnit], '');
  const eerr = b => (X.cleanReport(b, caller, FLEET, NOW).error || '');
  ok('no unit is refused', /Which unit/.test(eerr({ ...EQ, unit: '' })));
  ok('an unknown unit with no depot is refused', /Which depot/.test(eerr({ ...EQ, unit: '7777-01' })));
  ok('no location type is refused', /highway or in the yard/.test(eerr({ ...EQ, locationType: '' })));
  ok('on the highway: route and km are required', /Pick the route/.test(eerr({ ...EQ, locationType: 'Highway' })));
  ok('…and kept when given', X.cleanReport({ ...EQ, locationType: 'Highway', route: 'Route 2', direction: 'EB', km: 239 }, caller, FLEET, NOW).fields[F.km] === 239);
  ok('spare unanswered is refused', /spare deployed/.test(eerr({ ...EQ, spareDeployed: '' })));
  ok('mechanic unanswered is refused', /mechanic called/.test(eerr({ ...EQ, mechanicCalled: undefined })));
  ok('tow unanswered is refused', /tow called/.test(eerr({ ...EQ, towCalled: 'Maybe' })));
  ok('an unknown plow route is refused', /Unknown plow route/.test(eerr({ ...EQ, plowRoutes: ['Burton Subdivision'] })));
  ok('no description is refused', /what is wrong with the unit/.test(eerr({ ...EQ, description: '' })));
  eq('describeUnit drops a repeated make ("Ford Ford F550")', X.describeUnit({ make: 'Ford', model: 'Ford F550', designation: 'Mechanic Truck' }), 'Ford F550 · Mechanic Truck');

  /* 3 — closing */
  const bd = { kind: 'MRDC equipment', observedAt: '2027-01-20T04:00:00.000Z' };
  c = X.cleanClose({ notes: 'DEF sensor replaced' }, bd, caller, NOW);
  eq('back in service: Closed, now, by me, with notes', [c.fields[F.status], c.fields[F.closedAt], c.fields[F.closedBy], c.fields[F.closeNotes]], ['Closed', NOW.toISOString(), 'Tom Gibson', 'DEF sensor replaced']);
  ok('closing before it was reported is refused', /before it was reported/.test(X.cleanClose({ at: '2027-01-20T03:00:00Z' }, bd, caller, NOW).error || ''));
  ok('a nameless close says what is missing', /Who put it back in service/.test(X.cleanClose({ by: ' ' }, bd, { name: '' }, NOW).error || '') &&
    /Who cleared it/.test(X.cleanClose({ by: ' ' }, { kind: 'Public vehicle' }, { name: '' }, NOW).error || ''));

  /* 4 — recipients */
  reset();
  const C = require(path.join(__dirname, '..', 'api', '_conditions.js'));
  let dir = await C.directory();
  eq('nobody subscribed: patrollers and management (winter patrollers even off-season), not operators, not the Quality Manager, not inactive, not a bad address',
    X.recipients(dir, 'MRDC equipment').sort(), ['derek@x.ca', 'gm@x.ca', 'james@x.ca', 'ops@x.ca', 'tom@x.ca']);
  DB.emp[1].fields.fldFejJ45fAYDWJlW = [{ name: 'Equipment Breakdowns' }];
  DB.emp[5].fields.fldFejJ45fAYDWJlW = [{ name: 'Public Breakdowns' }];
  dir = await C.directory();
  eq('each kind has its own list once anyone subscribes', [X.recipients(dir, 'MRDC equipment'), X.recipients(dir, 'Public vehicle')], [['derek@x.ca'], ['tom@x.ca']]);

  /* 5 — the endpoint */
  reset('Everyone');
  session = null;
  eq('signed out: 401', (await call('GET', {})).code, 401);
  session = S('Tom Gibson');
  X.resetFleet();
  const meta = (await call('GET', { meta: '1' })).body;
  eq('meta: the active fleet only, with descriptions, SNIC first, the rest after', meta.fleet.map(u => [u.unit, u.depot, u.description, u.group]),
    [['1621-50', 'River Glade', 'International · D13 U-Body', 'snic'], ['2021-48', 'Oromocto', 'Ford F550 · Mechanic Truck', '']]);
  eq('…with the group labels', meta.unitGroups.map(g => g.label), ['SNIC equipment', 'One tons', 'Pickups']);
  // Troy, 2026-10-08: "primarily used by patrollers to record when SNIC equipment is down, one tons, and pickups can be included"
  const G = (series, designation) => X.unitGroup({ series, designation });
  eq('groups: plow truck, loader, snow blower, tow-behind plow, spreader, wing, brine → SNIC',
    [G('21', 'D13 U-Body'), G('30', 'Loader'), G('33', 'Snow Blower'), G('40', 'tow behind plow'), G('50', 'Frame Mount Spreader'), G('50', ' Everest left wing mounted on 321-37'), G('50', '8100 L (Brine)')],
    ['snic', 'snic', 'snic', 'snic', 'snic', 'snic', 'snic']);
  eq('…a TMA, a mower, a trailer, a cone truck are not', [G('50', 'Traffic Control TMA MS00985'), G('33', 'Mowing'), G('40', 'Enclosed Trailer'), G('20', '4300 Cone Truck')], ['', '', '', '']);
  eq('…one tons and pickups', [G('12', 'West Operations'), G('10', 'East Patroller')], ['oneton', 'pickup']);
  eq('…ordered SNIC, one tons, pickups, then the rest', X.fleetForPicker([{ unit: '1910-01', series: '10' }, { unit: '2021-48', series: '20' }, { unit: '1712-02', series: '12' },
    { unit: '2321-10', series: '21' }, { unit: '1621-37', series: '21' }]).map(u => u.unit), ['1621-37', '2321-10', '1712-02', '1910-01', '2021-48']);
  eq('meta: depots include Mazerolle; EB / WB', [meta.depots, meta.directions], [['Oromocto', 'Mazerolle', 'Bagdad', 'River Glade'], ['EB', 'WB']]);
  let r = await call('POST', {}, { ...PUB });
  eq('public: 201, Open, emailed', [r.code, r.body.breakdown.status, r.body.email && r.body.email.sent], [201, 'Open', 5]);
  ok('…the email says abandoned, where, and how it sits', MAIL[0] && /^Abandoned vehicle — Route 2 WB km 324\.6, shoulder$/.test(MAIL[0].subject) && /Grey Tucson J0G 149/.test(MAIL[0].html), MAIL[0] && MAIL[0].subject);
  ok('…sent through the public switch, recorded on the record', /Reported .*: .*derek@x\.ca/.test(DB.bd[0].fields[F.emailedTo]) && /recSWPUB/.test(JSON.stringify(CALLS.filter(x => x.method === 'PATCH' && /tbltvyYslcnGUGndD/.test(x.u)).map(x => x.u))));
  const pid = r.body.breakdown.id;
  r = await call('POST', {}, { ...EQ });
  eq('equipment: 201, the fleet record stamped, emailed', [r.code, r.body.breakdown.fleetRecord, r.body.email && r.body.email.sent], [201, 'recF1', 5]);
  ok('…the email names the unit, depot, routes affected, spare / mechanic / tow', MAIL[1] && /^Equipment down — 1621-50 \(International · D13 U-Body\), River Glade$/.test(MAIL[1].subject) &&
    /River Glade East/.test(MAIL[1].html) && /1521-60/.test(MAIL[1].html) && /River Glade yard/.test(MAIL[1].html), MAIL[1] && MAIL[1].subject);
  const eid = r.body.breakdown.id;
  r = await call('GET', {});
  eq('the list: both open, oldest first', r.body.open.map(a => a.id), [pid, eid]);
  eq('a bad report is a 400', (await call('POST', {}, { ...PUB, km: '' })).code, 400);
  eq('an unknown action is a 400', (await call('POST', { id: eid, action: 'delete' }, {})).code, 400);
  eq('a bad id is a 400', (await call('POST', { id: 'x', action: 'close' }, {})).code, 400);
  session = S('Derek Melanson');
  r = await call('POST', { id: eid, action: 'close' }, { notes: 'DEF sensor replaced' });
  eq('back in service (by the next shift): 200, same record, Closed, emailed', [r.code, r.body.breakdown.id, r.body.breakdown.status, r.body.breakdown.closedBy, r.body.email && r.body.email.sent],
    [200, eid, 'Closed', 'Derek Melanson', 5]);
  ok('…the email says back in service, who, and the notes', MAIL[2] && /^Back in service — 1621-50/.test(MAIL[2].subject) && /by Derek Melanson/.test(MAIL[2].html) && /DEF sensor replaced/.test(MAIL[2].html), MAIL[2] && MAIL[2].subject);
  ok('…both emails are kept on the record', (DB.bd[1].fields[F.emailedTo].match(/^(Reported|Closed) /gm) || []).length === 2, DB.bd[1].fields[F.emailedTo]);
  r = await call('POST', { id: pid, action: 'close' }, {});
  eq('a public vehicle cleared: 200, no second email', [r.code, r.body.breakdown.status, r.body.email, MAIL.length], [200, 'Closed', null, 3]);
  r = await call('POST', { id: eid, action: 'close' }, {});
  ok('closing twice: 409, says when and who', r.code === 409 && /Already back in service — .* by Derek Melanson/.test(r.body.error), JSON.stringify(r.body));
  r = await call('GET', {});
  eq('the list: nothing open, both in recent', [r.body.open.length, r.body.recent.length], [0, 2]);
  DB.bd.push({ id: 'recOLDCLOSEDaaaaa', fields: { [F.status]: { name: 'Closed' }, [F.observedAt]: new Date(Date.now() - 60 * 864e5).toISOString() } });
  DB.bd.push({ id: 'recOLDOPENaaaaaaa', fields: { [F.status]: { name: 'Open' }, [F.kind]: { name: 'MRDC equipment' }, [F.observedAt]: new Date(Date.now() - 60 * 864e5).toISOString() } });
  r = await call('GET', {});
  ok('an old closed one drops out; a unit down for two months stays on the list', !r.body.recent.some(a => a.id === 'recOLDCLOSEDaaaaa') && r.body.open.some(a => a.id === 'recOLDOPENaaaaaaa'));

  // fleet unreadable never holds a breakdown up
  reset('Everyone'); session = S('Tom Gibson'); X.resetFleet(); DB.fleet = null;
  r = await call('POST', {}, { ...EQ, depot: 'River Glade' });
  eq('fleet unreadable: still saved, unit as typed, no record id', [r.code, r.body.breakdown.unit, r.body.breakdown.fleetRecord], [201, '1621 50', '']);

  // Owner test / Off / mail down
  reset('Owner test'); session = S('Tom Gibson'); X.resetFleet();
  r = await call('POST', {}, { ...PUB });
  ok('Owner test: only the Owner, marked [TEST], naming who it would reach', MAIL.length === 1 && JSON.stringify(MAIL[0].to) === '["troy@x.ca"]' && /^\[TEST\] /.test(MAIL[0].subject) && /would go to 5 people/.test(MAIL[0].html));
  reset('Off'); session = S('Tom Gibson');
  r = await call('POST', {}, { ...PUB });
  ok('Off: saved, no mail, says why', r.code === 201 && !MAIL.length && /switch is Off/.test(DB.bd[0].fields[F.emailedTo]));
  reset('Everyone'); DB.sw = []; session = S('Tom Gibson');
  r = await call('POST', {}, { ...PUB });
  ok('no switch row = Off', r.code === 201 && !MAIL.length);
  reset('Everyone'); MAIL_FAIL = true; session = S('Tom Gibson');
  r = await call('POST', {}, { ...PUB });
  ok('mail down: the breakdown is still saved, and it says so', r.code === 201 && DB.bd.length === 1 && /Saved, but the email did not go/.test(r.body.emailError || ''), JSON.stringify(r.body));

  console.log(failures.map(f => '   FAIL  ' + f).join('\n'));
  console.log(`\n  test-breakdowns: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
