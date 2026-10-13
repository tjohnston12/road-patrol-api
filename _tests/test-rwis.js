// test-rwis.js — run with an ABSOLUTE path:
//   node <repo>/road-patrol-api/_tests/test-rwis.js
// Zero dependencies; no browser, no network, no credentials.
//
// RWIS Temperature Check (2026-10-13). The patrol truck's air and road readings against one of the
// seven RWIS stations. Troy: flag at a 2 °C difference (air or road); a flagged check emails the
// "RWIS Checks" list (fallback Operations Manager + Area Managers) on the "RWIS check email" switch.
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
function reset(mode, repMode) {
  DB = { rw: [], rep: [], sw: [{ id: 'recSWRWISaaaaaaaa', fields: { fldTBJ7i26yh7QLez: 'RWIS check email', fld6HLkbk1mKMq46D: { name: mode || 'Everyone' } } },
                              { id: 'recSWREPaaaaaaaaa', fields: { fldTBJ7i26yh7QLez: 'RWIS repair email', fld6HLkbk1mKMq46D: { name: repMode || mode || 'Everyone' } } }],
    fleet: [FL('recF1', '2210-44', 'Active', '10', 'Chevy', 'Silverado', 'West Patroller', 'Oromocto'), FL('recF2', '1621-50', 'Active', '21', 'Volvo', '', 'D13 U-Body', 'Bagdad'),
            FL('recF3', '1410-23', 'Retired', '10', 'Chevy', '', 'West Patroller', 'Oromocto')],
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
const T = { tbl1s5XA4LqAMHY3H: 'rep', tblfnW5kpD7SkTOqv: 'rw', tblNiXX7E11K4Gfzy: 'fleet', tbltvyYslcnGUGndD: 'sw', tblUfWrGjHTHXszos: 'emp', tblGXm5nDaxGppjVj: 'dl' };
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
const handler = require(path.join(__dirname, '..', 'api', 'rwis.js'));
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
const GOOD = { station: 'Dubee Settlement', truck: '2210 44', ptAir: '-6.0', rwisAir: '-5.2', ptRoad: '-3.1', rwisRoad: '-2.4' };
const FLEET = [{ unit: '2210-44', recId: 'recF1' }];

(async () => {
  /* 1 — the rules */
  let c = X.cleanCheck(GOOD, caller, FLEET, NOW);
  ok('a good check is accepted', !c.error, c.error);
  eq('…differences are station minus truck, to 0.1', [c.fields[F.airDiff], c.fields[F.roadDiff]], [0.8, 0.7]);
  eq('…not flagged under 2 °C', c.fields[F.flagged], 'No');
  eq('…the truck matched to the fleet', [c.fields[F.truck], c.fields[F.fleet]], ['2210-44', 'recF1']);
  ok('…an id in Atlantic time', /^RW-20270120-0125-[A-Z0-9]{4}$/.test(c.fields[F.id]), c.fields[F.id]);
  eq('…checked by the signed-in user unless named', [c.fields[F.checkedBy], c.fields[F.enteredBy]], ['Tom Gibson', 'Tom Gibson']);
  eq('exactly 2.0 °C on the road flags', X.cleanCheck({ ...GOOD, rwisRoad: '-1.1' }, caller, FLEET, NOW).fields[F.flagged], 'Yes');
  eq('1.9 °C does not', X.cleanCheck({ ...GOOD, rwisRoad: '-1.2' }, caller, FLEET, NOW).fields[F.flagged], 'No');
  eq('a station reading COLDER by 2 °C flags too', X.cleanCheck({ ...GOOD, rwisAir: '-8.0' }, caller, FLEET, NOW).fields[F.flagged], 'Yes');
  eq('a truck not on the fleet is kept as typed', (f => [f[F.truck], f[F.fleet]])(X.cleanCheck({ ...GOOD, truck: 'R-77' }, caller, FLEET, NOW).fields), ['R-77', '']);
  const err = b => (X.cleanCheck(b, caller, FLEET, NOW).error || '');
  ok('an unknown station is refused', /Which RWIS station/.test(err({ ...GOOD, station: 'Moncton' })));
  ok('no truck is refused', /patrol truck/.test(err({ ...GOOD, truck: '' })));
  ok('each of the four readings is required', /truck's air/.test(err({ ...GOOD, ptAir: '' })) && /station's air/.test(err({ ...GOOD, rwisAir: '' }))
    && /truck's road/.test(err({ ...GOOD, ptRoad: 'x' })) && /station's road/.test(err({ ...GOOD, rwisRoad: '' })));
  ok('an impossible temperature is refused', /truck's road/.test(err({ ...GOOD, ptRoad: '150' })));
  ok('a time in the future is refused', /future/.test(err({ ...GOOD, checkedAt: new Date(NOW.getTime() + 3600000).toISOString() })));
  // station offline (Troy: "if the rwis station is off line or not showing temps, how do the patrollers enter an n/a")
  c = X.cleanCheck({ ...GOOD, rwisRoad: '', rwisRoadNA: true }, caller, FLEET, NOW);
  ok('station road "no reading": accepted without a value', !c.error, c.error);
  eq('…station value and diff left blank, the air still compared', [c.fields[F.rwisRoad], c.fields[F.roadDiff], c.fields[F.airDiff]], [null, null, 0.8]);
  eq('…recorded as no reading, and flagged so the station gets looked at', [c.fields[F.noReading], c.fields[F.flagged]], [['Road'], 'Yes']);
  ok('…the truck readings are still required', /truck's road/.test(err({ ...GOOD, ptRoad: '', rwisRoadNA: true })));
  ok('no station value and no "no reading": refused, and it says how', /or tick "No reading"/.test(err({ ...GOOD, rwisAir: '' })));
  eq('both offline: both listed', X.cleanCheck({ ...GOOD, rwisAir: '', rwisAirNA: true, rwisRoad: '', rwisRoadNA: true }, caller, FLEET, NOW).fields[F.noReading], ['Air', 'Road']);
  eq('"no reading" must be a real true, not a string', !!err({ ...GOOD, rwisAir: '', rwisAirNA: 'yes' }), true);
  eq('seven stations, west to east', X.STATIONS.map(s => s.station), ['Longs Creek', 'Saint John River Bridge', 'Mill Cove', 'Fire Road', 'Dubee Settlement', 'Salisbury', 'Magnetic Hill']);

  /* 2 — who gets the email */
  reset();
  const C = require(path.join(__dirname, '..', 'api', '_conditions.js'));
  let dir = await C.directory();
  eq('fallback: Operations Manager and active Area Managers with a real address', X.recipients(dir).sort(), ['derek@x.ca', 'ops@x.ca']);
  DB.emp[5].fields.fldFejJ45fAYDWJlW = [{ name: 'RWIS Checks' }];
  dir = await C.directory();
  eq('once anyone subscribes, the list only', X.recipients(dir), ['tom@x.ca']);

  /* 3 — the endpoint */
  reset('Everyone');
  session = null;
  eq('signed out: 401', (await call('GET', {})).code, 401);
  session = S('Tom Gibson');
  const meta = (await call('GET', { meta: '1' })).body;
  eq('meta: the stations, the threshold, the ACTIVE patrol trucks', [meta.stations.length, meta.threshold, meta.trucks.map(t => t.unit)], [7, 2, ['2210-44']]);
  let r = await call('POST', {}, GOOD);
  eq('a normal check: 201, saved, no email', [r.code, r.body.check.flagged, r.body.email, MAIL.length], [201, false, null, 0]);
  r = await call('POST', {}, { ...GOOD, station: 'Salisbury', rwisRoad: '0.5', comments: 'sensor iced?' });
  eq('a flagged check: 201, emailed', [r.code, r.body.check.flagged, r.body.email && r.body.email.sent], [201, true, 2]);
  ok('…the subject names the station and both gaps', MAIL[0] && /^RWIS station off — Salisbury \(air \+0\.8 °C, road \+3\.6 °C\)$/.test(MAIL[0].subject), MAIL[0] && MAIL[0].subject);
  ok('…the email says what to do and carries the comment', /check the station before relying/.test(MAIL[0].html) && /sensor iced\?/.test(MAIL[0].html));
  ok('…recorded on the check', /^Flagged .*: (derek@x\.ca, ops@x\.ca|ops@x\.ca, derek@x\.ca)$/.test(DB.rw[1].fields[F.emailedTo]), DB.rw[1].fields[F.emailedTo]);
  MAIL = [];
  r = await call('POST', {}, { ...GOOD, station: 'Mill Cove', rwisAir: '', rwisAirNA: true, rwisRoad: '', rwisRoadNA: true });
  const nr = MAIL.find(m => /^RWIS station not reporting/.test(m.subject));
  ok('an offline station: saved, flagged, emailed as NOT REPORTING', r.code === 201 && r.body.check.flagged && nr && /^RWIS station not reporting — Mill Cove \(air no reading, road no reading\)$/.test(nr.subject), MAIL.map(m => m.subject).join(' | '));
  ok('…the email says to check the station', nr && /offline or not showing air and road temperature/.test(nr.html));
  DB.rw.pop(); DB.rep = [];
  r = await call('GET', {});
  eq('the board: each station\'s latest check', r.body.stations.filter(s => s.last).map(s => [s.station, s.last.flagged]), [['Dubee Settlement', false], ['Salisbury', true]]);
  eq('…recent, newest first', r.body.recent.length, 2);
  reset('Owner test'); session = S('Tom Gibson'); MAIL = [];
  r = await call('POST', {}, { ...GOOD, rwisAir: '0' });
  eq('Owner test: only the Owner, marked [TEST]', [MAIL.length, MAIL[0] && MAIL[0].to, MAIL[0] && /^\[TEST\]/.test(MAIL[0].subject)], [1, ['troy@x.ca'], true]);
  reset('Off'); session = S('Tom Gibson');
  r = await call('POST', {}, { ...GOOD, rwisAir: '0' });
  ok('switch Off: saved, nothing sent, and it says why', r.code === 201 && MAIL.length === 0 && /switch is Off/.test(r.body.email.note), JSON.stringify(r.body.email));
  reset('Everyone'); session = S('Tom Gibson'); MAIL_FAIL = true;
  r = await call('POST', {}, { ...GOOD, rwisAir: '0' });
  ok('mail down: the check is still saved', r.code === 201 && DB.rw.length === 1 && /email did not go/.test(r.body.emailError), JSON.stringify(r.body));
  eq('bad input: 400 and nothing saved', [(await call('POST', {}, { ...GOOD, station: '' })).code, DB.rw.length], [400, 1]);

  /* 4 — repair tickets (Troy: "if it is entered as offline or no reading create an email notification or a ticket
         that gets sent myself, and a contractor to be named later for repair") */
  const RF = X.R;
  reset('Everyone'); session = S('Tom Gibson');
  r = await call('POST', {}, { ...GOOD, rwisAir: '0' });
  eq('a 2 °C gap alone opens no ticket', [DB.rep.length, r.body.ticket], [0, undefined]);
  MAIL = [];
  r = await call('POST', {}, { ...GOOD, station: 'Fire Road', rwisRoad: '', rwisRoadNA: true });
  eq('no road reading: one ticket opened for the station', [DB.rep.length, r.body.ticketNew, r.body.ticket.station, r.body.ticket.status, r.body.ticket.problem], [1, true, 'Fire Road', 'Open', ['No road reading']]);
  ok('…a ticket id', /^RR-\d{8}-\d{4}-[A-Z0-9]{4}$/.test(r.body.ticket.ticketId), r.body.ticket.ticketId);
  ok('…the check is logged on the ticket', /RW-.*Tom Gibson \(truck 2210-44\).*No road reading/.test(DB.rep[0].fields[RF.checks]), DB.rep[0].fields[RF.checks]);
  const rm = MAIL.find(m => /^RWIS repair needed/.test(m.subject));
  ok('…a repair email, separate from the check email', rm && /^RWIS repair needed — Fire Road \(no road reading\)$/.test(rm.subject) && MAIL.length === 2, MAIL.map(m => m.subject).join(' | '));
  eq('…nobody subscribed to RWIS Repairs: the Owner gets it', rm && rm.to, ['troy@x.ca']);
  ok('…recorded on the ticket', /^Opened .*: troy@x\.ca$/.test(DB.rep[0].fields[RF.emailedTo]), DB.rep[0].fields[RF.emailedTo]);
  MAIL = [];
  r = await call('POST', {}, { ...GOOD, station: 'Fire Road', rwisAir: '', rwisAirNA: true, comments: 'screen blank' });
  eq('a second offline check at the same station: added to the open ticket, no new ticket', [DB.rep.length, r.body.ticketNew, r.body.ticket.problem.sort()], [1, false, ['No air reading', 'No road reading']]);
  eq('…no second repair email', MAIL.filter(m => /^RWIS repair/.test(m.subject)).length, 0);
  eq('…both checks in the log', DB.rep[0].fields[RF.checks].split('\n').length, 2);
  await call('POST', {}, { ...GOOD, station: 'Salisbury', rwisAir: '', rwisAirNA: true });
  eq('another station: its own ticket', DB.rep.map(t => t.fields[RF.station]), ['Fire Road', 'Salisbury']);
  DB.emp[0].fields.fldFejJ45fAYDWJlW = [{ name: 'RWIS Repairs' }];
  DB.dl.push({ id: 'recDL1', fields: {} });
  let dir2 = await C.directory();
  eq('once Troy subscribes, the list only', X.repairRecipients(dir2), ['troy@x.ca']);
  r = await call('GET', {});
  eq('the board: open tickets, and on each station', [r.body.repairs.open.map(t => t.station), r.body.stations.find(s => s.station === 'Fire Road').ticket.ticketId === DB.rep[0].fields[RF.id]], [['Fire Road', 'Salisbury'], true]);
  const tid = DB.rep[0].id;
  eq('repaired: notes required', (await call('POST', { id: tid, action: 'repaired' }, { notes: '' })).code, 400);
  eq('repaired: unknown action refused', (await call('POST', { id: tid, action: 'close' }, { notes: 'x' })).code, 400);
  eq('repaired: bad id refused', (await call('POST', { id: 'nope', action: 'repaired' }, { notes: 'fixed it' })).code, 400);
  ok('repaired: not before it was opened', /before the ticket was opened/.test((await call('POST', { id: tid, action: 'repaired' }, { notes: 'fixed', at: '2020-01-01T00:00:00Z' })).body.error));
  ok('repaired: a few days later is fine (not a one-day limit)', X.cleanRepaired({ notes: 'fixed', at: '2027-01-24T12:00:00Z' }, { openedAt: '2027-01-20T05:00:00Z' }, caller, new Date('2027-01-25T12:00:00Z')).fields !== undefined);
  MAIL = [];
  r = await call('POST', { id: tid, action: 'repaired' }, { notes: 'Replaced road sensor cable', contractor: 'Acme Weather Ltd' });
  eq('repaired: 200, closed, by the signed-in user', [r.code, r.body.ticket.status, r.body.ticket.repairedBy, r.body.ticket.contractor], [200, 'Repaired', 'Tom Gibson', 'Acme Weather Ltd']);
  ok('…the repaired email to the same list', MAIL[0] && /^RWIS station repaired — Fire Road$/.test(MAIL[0].subject) && /Replaced road sensor cable/.test(MAIL[0].html) && /Acme Weather Ltd/.test(MAIL[0].html), MAIL[0] && MAIL[0].subject);
  eq('…twice is refused', (await call('POST', { id: tid, action: 'repaired' }, { notes: 'again' })).code, 409);
  r = await call('GET', {});
  eq('…off the open list, on the repaired list', [r.body.repairs.open.map(t => t.station), r.body.repairs.repaired.map(t => t.station)], [['Salisbury'], ['Fire Road']]);
  MAIL = [];
  await call('POST', {}, { ...GOOD, station: 'Fire Road', rwisRoad: '', rwisRoadNA: true });
  eq('offline again after a repair: a NEW ticket', [DB.rep.length, MAIL.filter(m => /^RWIS repair needed/.test(m.subject)).length], [3, 1]);
  reset('Everyone', 'Off'); session = S('Tom Gibson'); MAIL = [];
  r = await call('POST', {}, { ...GOOD, rwisRoad: '', rwisRoadNA: true });
  ok('repair switch Off: ticket still opened, no repair email, says why', DB.rep.length === 1 && !MAIL.some(m => /^RWIS repair/.test(m.subject)) && /switch is Off/.test(r.body.ticketEmail.note), JSON.stringify(r.body.ticketEmail));
  reset('Everyone', 'Owner test'); session = S('Tom Gibson'); MAIL = [];
  DB.emp[1].fields.fldFejJ45fAYDWJlW = [{ name: 'RWIS Repairs' }];
  await call('POST', {}, { ...GOOD, rwisRoad: '', rwisRoadNA: true });
  const tm = MAIL.find(m => /RWIS repair/.test(m.subject));
  ok('repair Owner test: Owner only, [TEST], names who it would reach', tm && /^\[TEST\] RWIS repair needed/.test(tm.subject) && tm.to.join() === 'troy@x.ca' && /derek@x\.ca/.test(tm.html), tm && tm.subject);

  console.log(failures.map(f => '   FAIL  ' + f).join('\n'));
  console.log(`\n  test-rwis: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
