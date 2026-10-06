// test-conditions.js — run with an ABSOLUTE path:
//   node <repo>/road-patrol-api/_tests/test-conditions.js
// Zero dependencies; no browser, no network, no credentials.
//
// Winter Road Conditions (2026-10-06). Troy, picking Phase 3 back up: build this
// first; the PMCC report to him only while testing; the adverse alert is "a button
// that the patroller hits to alert other patrollers and managers".
//   1. the rules: depots, routes by depot, the 12 conditions, times
//   2. the PMCC report: Atlantic slots across DST, the window, NOT OBSERVED
//   3. who gets mail, and the Off / Owner test / Everyone switch
//   4. the endpoint: sign-in first, save, alert once, who may alert
//   5. the cron: fails closed, one row per slot, never twice, winter only
'use strict';
const path = require('path');
const Module = require('module');

const libPath = path.join(__dirname, '..', 'api', '_lib.js');
const realLib = require(libPath);
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, x) => { if (c) pass++; else { fail++; failures.push(n + (x !== undefined ? ` — ${String(x).slice(0, 300)}` : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), `got ${JSON.stringify(g)} want ${JSON.stringify(w)}`);

// ── fake Airtable + mail, behind the real _lib's helpers ─────────────────────
let DB, CALLS, MAIL;
function reset() {
  DB = { obs: [], pmcc: [], sw: [
      { id: 'recSW1aaaaaaaaaaa', fields: { fldTBJ7i26yh7QLez: 'PMCC report', fld6HLkbk1mKMq46D: { name: 'Owner test' } } },
      { id: 'recSW2aaaaaaaaaaa', fields: { fldTBJ7i26yh7QLez: 'Adverse conditions alert', fld6HLkbk1mKMq46D: { name: 'Owner test' } } }],
    emp: [
      { id: 'recE1', fields: { fldtLjh72SJV8Uyfb: 'Troy Johnston', fldBggHLMX7abWiSK: 'troy@x.ca', fldWRmtEbJ6tfyLX1: { name: 'Owner' }, fldJkDrwa6kc0IJnA: [{ name: 'Quality Manager' }], fldcHPqfxScpuUbZ6: { name: 'Active' } } },
      { id: 'recE2', fields: { fldtLjh72SJV8Uyfb: 'Derek Melanson', fldBggHLMX7abWiSK: 'derek@x.ca', fldJkDrwa6kc0IJnA: [{ name: 'Area Manager' }], fldcHPqfxScpuUbZ6: { name: 'Active' } } },
      { id: 'recE3', fields: { fldtLjh72SJV8Uyfb: 'James Rodey', fldBggHLMX7abWiSK: 'james@x.ca', fldJkDrwa6kc0IJnA: [{ name: 'Patroller - Winter' }], fldcHPqfxScpuUbZ6: { name: 'Inactive' } } },
      { id: 'recE4', fields: { fldtLjh72SJV8Uyfb: 'Tom Gibson', fldBggHLMX7abWiSK: 'tom@x.ca', fldJkDrwa6kc0IJnA: [{ name: 'Patroller - Full Time' }], fldcHPqfxScpuUbZ6: { name: 'Active' } } },
      { id: 'recE5', fields: { fldtLjh72SJV8Uyfb: 'Brent Ross', fldBggHLMX7abWiSK: 'brent@x.ca', fldJkDrwa6kc0IJnA: [{ name: 'Bridge Crew' }], fldcHPqfxScpuUbZ6: { name: 'Active' } } },
      { id: 'recE6', fields: { fldtLjh72SJV8Uyfb: 'Old Manager', fldBggHLMX7abWiSK: 'old@x.ca', fldJkDrwa6kc0IJnA: [{ name: 'Area Manager' }], fldcHPqfxScpuUbZ6: { name: 'Inactive' } } }],
    dl: [{ id: 'recD1', fields: { fldc22IrOlNLqIEKo: 'Oromocto tablet', flderIfr2j2OpQbc1: 'oromocto@x.ca', fldbJ8Qy4QHhBrTzm: [{ name: 'Work Zone Audits' }], fldshxalFiAb8egad: { name: 'Active' } } }],
  };
  CALLS = []; MAIL = []; seq = 0;
}
let seq = 0;
const T = { 'tblEIzL4ESYpnotMU': 'obs', 'tblwkE93OpsImJOxK': 'pmcc', 'tbltvyYslcnGUGndD': 'sw', 'tblUfWrGjHTHXszos': 'emp', 'tblGXm5nDaxGppjVj': 'dl' };
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
  if (method === 'POST') { const r = { id: 'recNEW' + String(++seq).padStart(11, '0'), fields: JSON.parse(opts.body).fields }; rows.push(r); return JSON.parse(JSON.stringify(r)); }
  let out = rows;
  const ff = (u.match(/filterByFormula=([^&]*)/) || [])[1];
  if (ff && key === 'pmcc') { const k = (decodeURIComponent(ff.replace(/\+/g, ' ')).match(/\{Report\}='([^']+)'/) || [])[1]; if (k) out = rows.filter(r => r.fields.fldjfdFiFcpmHrSoW === k); }
  return { records: JSON.parse(JSON.stringify(out)) };
}
require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: Object.assign({}, realLib, {
  airtable,
  sendMailDetailed: async m => { MAIL.push(m); return { sent: m.to, reason: '' }; },
  getPatrollers: async () => [{ name: 'Tom Gibson' }, { name: 'James Rodey' }],
}) };
const C = require(path.join(__dirname, '..', 'api', '_conditions.js'));

let session = null;
global.fetch = async url => {
  if (/\/api\/session/.test(String(url))) return session ? { ok: true, status: 200, json: async () => session } : { ok: false, status: 401, json: async () => ({ ok: false }) };
  throw new Error('unexpected fetch ' + url);
};
const S = (name, orgRole = 'Employee', appRole = 'User') => ({ ok: true, allowed: true, appRole, apps: ['Patrol'], user: { name, role: orgRole, source: 'employee', employeeId: 'recX' } });
const handler = require(path.join(__dirname, '..', 'api', 'conditions.js'));
const cron = require(path.join(__dirname, '..', 'api', 'pmcc-report.js'));
async function call(h, method, query, body, headers) {
  const req = { method, query: query || {}, body, headers: Object.assign({ cookie: 'htra_session=abc', origin: 'https://www.mrdc-htra.com' }, headers || {}) };
  let code = 0, out = null;
  const res = { setHeader() {}, status(c) { code = c; return this; }, json(o) { out = o; return this; }, end() { return this; } };
  await h(req, res);
  return { code, body: out };
}

(async () => {
  /* ── 1. rules ─────────────────────────────────────────────────────────── */
  reset();
  eq('the three patrol depots (no Mazerolle — a route, not a patrol depot)', C.DEPOTS, ['Oromocto', 'Bagdad', 'River Glade']);
  eq('Oromocto: the Western plow routes', C.ROUTES.Oromocto, ['Oromocto East', 'Oromocto West', 'Mazerolle', 'Route 7']);
  eq('Bagdad and River Glade: the Eastern plow routes', [C.ROUTES.Bagdad, C.ROUTES['River Glade']], [['Bagdad East', 'Bagdad West', 'River Glade East', 'River Glade West'], ['Bagdad East', 'Bagdad West', 'River Glade East', 'River Glade West']]);
  eq('the 12 conditions from the DeviceMagic export', C.CONDITIONS.length, 12);
  const me = { name: 'Tom Gibson' }, NOW = new Date('2026-12-01T15:00:00Z');
  const good = C.cleanObservation({ depot: 'Oromocto', route: 'Mazerolle', conditions: ['Snow Packed', 'Snow Packed'], comments: ' ruts ' }, me, NOW);
  ok('a good observation', !good.error, good.error);
  eq('…division from the depot, conditions de-duplicated, comment trimmed', [good.fields[C.F.division], good.fields[C.F.conditions], good.fields[C.F.comments]], ['Western', ['Snow Packed'], 'ruts']);
  eq('…observed now, submitted by the session', [good.fields[C.F.observedAt], good.fields[C.F.submittedBy], good.fields[C.F.patroller]], [NOW.toISOString(), 'Tom Gibson', 'Tom Gibson']);
  ok('…an RC- number in Atlantic time', /^RC-20261201-1100-[A-Z0-9]{4}$/.test(good.fields[C.F.obsId]), good.fields[C.F.obsId]);
  ok('a route from the other division is refused', /Eastern Division/.test(C.cleanObservation({ depot: 'Bagdad', route: 'Route 7', conditions: ['Slushy'] }, me, NOW).error || ''));
  ok('no conditions is refused', !!C.cleanObservation({ depot: 'Bagdad', route: 'Bagdad East', conditions: [] }, me, NOW).error);
  ok('an unknown condition is refused', /Unknown/.test(C.cleanObservation({ depot: 'Bagdad', route: 'Bagdad East', conditions: ['Lava'] }, me, NOW).error || ''));
  ok('a time in the future is refused', !!C.cleanObservation({ depot: 'Bagdad', route: 'Bagdad East', conditions: ['Slushy'], observedAt: '2026-12-01T16:00:00Z' }, me, NOW).error);
  ok('a time more than a day ago is refused', !!C.cleanObservation({ depot: 'Bagdad', route: 'Bagdad East', conditions: ['Slushy'], observedAt: '2026-11-29T16:00:00Z' }, me, NOW).error);
  eq('an earlier time today is kept', C.cleanObservation({ depot: 'Bagdad', route: 'Bagdad East', conditions: ['Slushy'], observedAt: '2026-12-01T12:30:00Z' }, me, NOW).fields[C.F.observedAt], '2026-12-01T12:30:00.000Z');
  eq('colours: bare / snow / ice', [C.tone(['Bare Full Width']), C.tone(['Bare Wheel Tracks', 'Slushy']), C.tone(['Icy Spots'])], ['good', 'caution', 'bad']);

  /* ── 2. the PMCC report ───────────────────────────────────────────────── */
  eq('winter (AST): 06:00 Atlantic is 10:00 UTC', C.atAtlantic('2026-12-01', '06:00').toISOString(), '2026-12-01T10:00:00.000Z');
  eq('autumn (ADT): 06:00 Atlantic is 09:00 UTC', C.atAtlantic('2026-10-20', '06:00').toISOString(), '2026-10-20T09:00:00.000Z');
  eq('cron at 09 UTC in October: the 06:00 slot', C.slotAt(new Date('2026-10-20T09:00:30Z')), '06:00');
  eq('cron at 09 UTC in December (05:00 Atlantic): nothing', C.slotAt(new Date('2026-12-01T09:00:30Z')), '');
  eq('cron at 18 UTC in December: the 14:00 slot', C.slotAt(new Date('2026-12-01T18:01:00Z')), '14:00');
  eq('cron at 13 UTC in October: 10:00', C.slotAt(new Date('2026-10-20T13:00:00Z')), '10:00');
  eq('a run that arrives 55 minutes late is not taken for the slot', C.slotAt(new Date('2026-10-20T13:55:00Z')), '');
  const w6 = C.windowFor('2026-12-01', '06:00'), w10 = C.windowFor('2026-12-01', '10:00');
  eq('06:00 looks back to 14:00 the day before', [w6.start.toISOString(), w6.end.toISOString()], ['2026-11-30T18:00:00.000Z', '2026-12-01T10:00:00.000Z']);
  eq('10:00 looks back to 06:00', w10.start.toISOString(), '2026-12-01T10:00:00.000Z');
  ok('winter is 15 Oct – 15 Apr', C.inWinter('2026-10-15') && C.inWinter('2027-04-15') && !C.inWinter('2026-10-14') && !C.inWinter('2027-04-16'));
  const O = (route, at, conditions, extra) => Object.assign({ id: 'r' + route + at, route, depot: 'Oromocto', division: C.ROUTES.Oromocto.includes(route) ? 'Western' : 'Eastern', observedAt: at, conditions, patroller: 'Tom Gibson', comments: '', alertSent: false }, extra);
  const obs = [O('Oromocto East', '2026-12-01T11:00:00Z', ['Snow Covered']), O('Oromocto East', '2026-12-01T13:00:00Z', ['Bare Wheel Tracks']),
               O('Mazerolle', '2026-12-01T12:00:00Z', ['Icy Spots'], { alertSent: true }), O('Route 7', '2026-12-01T09:00:00Z', ['Slushy'])];
  const rep = C.buildReport('2026-12-01', '10:00', obs);
  ok('the newest observation of a route is the one reported', /Oromocto East: Bare Wheel Tracks — 09:00, Tom Gibson/.test(rep.text), rep.text);
  ok('a route last seen before the window is NOT OBSERVED', /Route 7: NOT OBSERVED since 06:00/.test(rep.text));
  eq('counts', [rep.observed, rep.notObserved], [2, 6]);
  ok('the alert in the window is listed', /alerts in this period:\n  08:00 Mazerolle — Icy Spots/.test(rep.text), rep.text);
  ok('the HTML escapes what patrollers typed', !/<script>/.test(C.buildReport('2026-12-01', '10:00', [O('Oromocto West', '2026-12-01T12:00:00Z', ['Slushy'], { comments: '<script>x</script>' })]).html));

  /* ── 3. who gets mail ─────────────────────────────────────────────────── */
  let dir = await C.directory();
  eq('alert, nobody subscribed yet: managers and patrollers by title (a seasonal winter patroller counts)', C.alertRecipients(dir).sort(), ['derek@x.ca', 'james@x.ca', 'tom@x.ca']);
  DB.emp[4].fields.fldFejJ45fAYDWJlW = [{ name: 'Winter Road Conditions' }];
  DB.dl[0].fields.fldbJ8Qy4QHhBrTzm = [{ name: 'Winter Road Conditions' }, { name: 'PMCC Road Conditions' }];
  dir = await C.directory();
  eq('once anyone subscribes, the list decides (people and mailboxes)', C.alertRecipients(dir).sort(), ['brent@x.ca', 'oromocto@x.ca']);
  eq('PMCC: the PMCC Road Conditions list', C.pmccRecipients(dir), ['oromocto@x.ca']);
  eq('Owner test: the Owner only, as a preview', C.deliveryFor('Owner test', ['a@x.ca'], dir), { to: ['troy@x.ca'], preview: true });
  eq('Everyone: the real list', C.deliveryFor('Everyone', ['a@x.ca'], dir), { to: ['a@x.ca'], preview: false });
  eq('Off: nobody', C.deliveryFor('Off', ['a@x.ca'], dir), { to: [], preview: false });
  DB.sw = [];
  eq('a switch with no row is Off', (await C.switchFor('PMCC report')).mode, 'Off');

  /* ── 4. the endpoint ──────────────────────────────────────────────────── */
  reset();
  session = null;
  const anon = await call(handler, 'POST', {}, { depot: 'Oromocto', route: 'Mazerolle', conditions: ['Slushy'] });
  ok('signed out: 401 and nothing touched', anon.code === 401 && !CALLS.length, anon.code);
  session = S('Tom Gibson');
  const meta = await call(handler, 'GET', { meta: '1' });
  eq('meta: depots, routes, the patroller list, who I am', [meta.code, meta.body.depots.length, meta.body.patrollers, meta.body.me, meta.body.admin], [200, 3, ['Tom Gibson', 'James Rodey'], 'Tom Gibson', false]);
  const saved = await call(handler, 'POST', {}, { depot: 'Oromocto', route: 'Mazerolle', conditions: ['Icy Spots'], comments: 'bridge deck' });
  eq('saved', saved.code, 201);
  eq('…and no alert unless asked', [saved.body.alert, MAIL.length], [undefined, 0]);
  const id = saved.body.observation.id;
  const board = await call(handler, 'GET', {});
  ok('the board shows it as Mazerolle\'s latest', board.body.board.find(b => b.route === 'Mazerolle').latest.id === id);
  eq('bad input is a 400', (await call(handler, 'POST', {}, { depot: 'Oromocto', route: 'Bagdad East', conditions: ['Slushy'] })).code, 400);
  session = S('Someone Else');
  eq('someone else cannot send my observation\'s alert', (await call(handler, 'POST', { id, action: 'alert' }, {})).code, 403);
  session = S('Tom Gibson');
  const al = await call(handler, 'POST', { id, action: 'alert' }, { note: 'salt truck on the way' });
  eq('the patroller can send its alert', al.code, 200);
  eq('…Owner test: one mail, to the Owner, marked TEST', [MAIL.length, MAIL[0].to, /^\[TEST\] Adverse road conditions — Mazerolle \(Oromocto\) — Icy Spots$/.test(MAIL[0].subject)], [1, ['troy@x.ca'], true]);
  ok('…the preview says who it would reach', /would go to 3 people: derek@x\.ca, james@x\.ca, tom@x\.ca/.test(MAIL[0].html), MAIL[0].html.slice(0, 300));
  ok('…the note is in it', /salt truck on the way/.test(MAIL[0].html));
  eq('…the observation records it', [al.body.observation.alertSent, /^Owner test: troy@x\.ca \(would go to 3\)$/.test(al.body.observation.alertSentTo)], [true, true]);
  const again = await call(handler, 'POST', { id, action: 'alert' }, {});
  eq('a second press: 409, no second mail', [again.code, MAIL.length], [409, 1]);
  DB.sw[1].fields.fld6HLkbk1mKMq46D = { name: 'Everyone' };
  const both = await call(handler, 'POST', {}, { depot: 'Bagdad', route: 'River Glade East', conditions: ['Drifting Snow'], alert: true });
  eq('save and alert in one: saved and sent to managers + patrollers', [both.code, MAIL.length, MAIL[1].to.sort()], [201, 2, ['derek@x.ca', 'james@x.ca', 'tom@x.ca']]);
  ok('…not marked TEST', !/^\[TEST\]/.test(MAIL[1].subject));
  DB.sw[1].fields.fld6HLkbk1mKMq46D = { name: 'Off' };
  const off = await call(handler, 'POST', {}, { depot: 'Bagdad', route: 'Bagdad West', conditions: ['Slushy'], alert: true });
  eq('switch Off: saved, nothing mailed, and it says why', [off.code, MAIL.length, off.body.observation.alertSentTo], [201, 2, 'not sent — the alert switch is Off']);
  session = S('Derek Melanson', 'Employee', 'Manager');
  DB.sw[1].fields.fld6HLkbk1mKMq46D = { name: 'Owner test' };
  const sup = await call(handler, 'POST', {}, { depot: 'Oromocto', route: 'Route 7', conditions: ['Slushy'] });
  eq('a supervisor can send anyone\'s alert', (await call(handler, 'POST', { id: sup.body.observation.id, action: 'alert' }, {})).code, 200);
  session = S('Tom Gibson');
  eq('preview is for supervisors', (await call(handler, 'GET', { preview: '1' })).code, 403);

  /* ── 5. the cron ──────────────────────────────────────────────────────── */
  reset();
  const saveEnv = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  eq('no CRON_SECRET: refuses to run', (await call(cron, 'GET', {}, null, { authorization: 'Bearer x' })).code, 401);
  eq('no CRON_SECRET: an empty bearer is refused too', (await call(cron, 'GET', {}, null, { authorization: 'Bearer ' })).code, 401);
  process.env.CRON_SECRET = 'sekrit';
  eq('wrong key: refused', (await call(cron, 'GET', {}, null, { authorization: 'Bearer nope' })).code, 401);
  DB.obs.push({ id: 'recO1aaaaaaaaaaaa', fields: { fldZfroAEphcoBlVZ: 'RC-1', fldf7cZDZHN8Vj4a4: '2026-12-01T12:00:00.000Z', fldJQMFCinVbjH6Ac: { name: 'Oromocto' }, fldeAXf7zmttVpkPE: { name: 'Western' }, fldZIAyiTBph4XIxH: { name: 'Mazerolle' }, fldKtKnzrlqBee2f8: [{ name: 'Slushy' }], fldLSZDQglSOuuMBW: 'Tom Gibson' } });
  const r1 = await cron._run({ now: new Date('2026-12-01T14:00:20Z') });
  eq('10:00 slot: Owner test, one mail to the Owner', [r1.key, r1.status, MAIL.length, MAIL[0].to], ['2026-12-01 10:00', 'Owner test', 1, ['troy@x.ca']]);
  eq('…one PMCC row, with the counts', [DB.pmcc.length, DB.pmcc[0].fields.fldBVzuEWrYKTJrep, DB.pmcc[0].fields.fld11lZ9ckVhWTnG3], [1, 1, 7]);
  ok('…the preview says no PMCC address is on file yet', /nobody — add the PMCC address/.test(MAIL[0].html));
  const r2 = await cron._run({ now: new Date('2026-12-01T14:10:00Z') });
  ok('the same slot again: skipped, no second mail or row', /already done/.test(r2.skipped) && MAIL.length === 1 && DB.pmcc.length === 1);
  ok('not a report hour: nothing', /not a report time/.test((await cron._run({ now: new Date('2026-12-01T15:00:00Z') })).skipped));
  ok('outside winter: nothing', /outside winter/.test((await cron._run({ now: new Date('2026-07-01T09:00:00Z') })).skipped || ''));
  DB.sw[0].fields.fld6HLkbk1mKMq46D = { name: 'Off' };
  const r3 = await cron._run({ now: new Date('2026-12-01T18:00:00Z') });
  eq('switch Off: still a row for the slot, marked Off, nothing mailed', [r3.status, DB.pmcc.length, MAIL.length], ['Off', 2, 1]);
  DB.sw[0].fields.fld6HLkbk1mKMq46D = { name: 'Everyone' };
  const r4 = await cron._run({ now: new Date('2026-12-02T10:00:00Z') });
  eq('Everyone with no PMCC address yet: Not sent, and the row says why', [r4.status, /no PMCC address/.test(DB.pmcc[2].fields.fldKwV3IKzu72q7YM)], ['Not sent', true]);
  const dry = await cron._run({ now: new Date('2026-07-01T09:00:00Z'), slot: '06:00', date: '2026-07-01', dry: true });
  ok('dry run: builds it, writes nothing', dry.dry && /NOT OBSERVED/.test(dry.text) && DB.pmcc.length === 3);
  if (saveEnv === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saveEnv;

  failures.forEach(f => console.log('   FAIL ', f));
  console.log(`\ntest-conditions: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
