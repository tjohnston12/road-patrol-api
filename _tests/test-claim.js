// test-claim.js — run with an ABSOLUTE path:
//   node <repo>/road-patrol-api/_tests/test-claim.js
// Zero dependencies; no browser, no network, no credentials.
//
// api/claim.js — the accident invoice in the MVA file (Troy, 2026-10-30: "the invoice is
// the next thing to build into the process for the patroller to complete"). Pins:
//   · the math matches the claims coordinator's real invoice 2025-02-04-331 WB to the cent
//     (markup 5% on third party, administration 5% with a $150 floor, HST 15%)
//   · rates come from Claim Rates and stay with the line once added
//   · the starting lines from the accident report (time at the scene, truck, items used)
//   · only the patroller (Open / Sent back) or an admin changes it; reviewers read it
//   · Mark complete is refused until every line is priced and invoices are attached,
//     and ticks the folder's "Claim invoice"; any later change unticks it.

const path = require('path');
const libPath = path.join(__dirname, '..', 'api', '_lib.js');
const authPath = path.join(__dirname, '..', 'api', '_auth.js');
const mvaPath = path.join(__dirname, '..', 'api', 'mva.js');
const CLAIM = path.join(__dirname, '..', 'api', 'claim.js');

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, x) => { if (c) pass++; else { fail++; failures.push(n + (x !== undefined ? ` — ${x}` : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), `got ${JSON.stringify(g)} want ${JSON.stringify(w)}`);

const T_RATES = 'tblWHinbvncbmvDzl', T_INV = 'tbluDkoE8Px4arkL8', T_AR = 'tblShwnpWGogKaZxG';
const RATE = (id, item, cat, rate, markup, unit, active) => ({ id, fields: { fldTncNpntgTi5uhL: item, fldEZhO0Gdll912JM: { name: cat }, fldR5L3RYOiLXh6HX: rate,
  fldQ3R8I6Ctn2A1WZ: markup, fldDWfuTzIVmMlbEN: unit, fldW8cJfa7nV8lLsr: active !== false } });
let RATES = [
  RATE('recLab0000000001', 'Labour', 'Accident Site Response', 60, 0, 'hour'),
  RATE('recTrk0000000001', 'Patrol Vehicle/Pick Up Truck', 'Accident Site Response', 35, 0, 'hour'),
  RATE('recFak0000000001', 'First Aid Kit', 'Accident Site Response', 60, 0, 'each'),
  RATE('recCon0000000001', 'Cones/Barrels/Signs', 'Traffic Control', 150, 0, 'unit charge'),
  RATE('recRLb0000000001', 'Labour', 'Asset Repair Costs', 60, 0, 'hour'),
  RATE('recPst0000000001', 'WOOD - 6\'0" Post 6x8 CRT', 'Asset Material Cost', 70.46, 0.2, 'each'),
  RATE('recSpl0000000001', 'Spill Kit / Disposal Fee', 'Asset Material Cost', 125, 0, 'fee'),
  RATE('recOld0000000001', 'Retired thing', 'Asset Repair Costs', 99, 0, 'each', false),
];
let INV = {}, AR = [], iseq = 0, uploads = [], ticks = [];
const airtable = async (p, opt = {}) => {
  const url = new URL('https://api.airtable.com/v0/' + p);
  const m = (opt.method || 'GET').toUpperCase(), body = opt.body ? JSON.parse(opt.body) : null;
  const [, , , table, id] = url.pathname.split('/');
  const byId = url.searchParams.get('returnFieldsByFieldId') === 'true' || !!(body && body.returnFieldsByFieldId);
  if (!byId) throw new Error('read by field name: ' + table);
  if (table === T_RATES) return { records: RATES };
  if (table === T_AR) return { records: AR };
  if (table === T_INV) {
    if (m === 'GET') { const want = ((url.searchParams.get('filterByFormula') || '').match(/='(.*)'$/) || [])[1];
      return { records: Object.values(INV).filter(r => r.fields.fldG5BvvnH14yGk7u === want).map(r => JSON.parse(JSON.stringify(r))) }; }
    if (m === 'POST') { const rec = { id: 'recI' + String(++iseq).padStart(13, '0'), fields: body.fields }; INV[rec.id] = rec; return rec; }
    if (m === 'PATCH') { const was = INV[id].fields.fld93100j7kUUERJY || [];
      if (body.fields.fld93100j7kUUERJY) body.fields.fld93100j7kUUERJY = body.fields.fld93100j7kUUERJY.map(a => was.find(w => w.id === a.id) || a);   // Airtable keeps a kept attachment's details
      Object.assign(INV[id].fields, body.fields); for (const [k, v] of Object.entries(body.fields)) if (v === null) delete INV[id].fields[k]; return JSON.parse(JSON.stringify(INV[id])); }
  }
  throw new Error('unexpected ' + m + ' ' + table);
};
require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: {
  PAT: 'stub', airtable, arr: x => (Array.isArray(x) ? x : x == null || x === '' ? [] : [x]), sel: x => (x && x.name) || x || '',
  cors: () => false, parseBody: req => req.body || {},
  uploadAttachment: async (o) => { uploads.push(o); const r = INV[o.recordId]; (r.fields.fld93100j7kUUERJY = r.fields.fld93100j7kUUERJY || []).push({ id: 'att' + uploads.length, url: 'https://x/' + o.filename, filename: o.filename, type: o.contentType }); },
} };
let session = null;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  requireCaller: async (req, res) => { if (!session) { res.status(401).json({ error: 'Not signed in' }); return null; } return session; },
} };
// The MVA file rule (mva.js): who sees it, who may change it. Stubbed so the invoice is tested on its own.
const FF = { done: 'fldUjL1uELhKd5O3P', doneBy: 'fldv9yBGj0fMQglnx', doneAt: 'fldEv5ndR6kFEojtP', updatedBy: 'fld6IhCHIoF9YjE10', updatedAt: 'fldQVnAa268exkeJq', notes: 'fld0HKIYmCVg8XA3I' };
let MVA = { id: 'recMVA0000000001', mvaNo: '2025-02-04-331.000-WB', stage: 'Open', patroller: 'Tom Gibson', date: '2025-02-04', route: 'Route 2', km: 331, direction: 'WB',
  division: 'Western', policeFile: '2025-155693', claimNo: '', damageDesc: 'Sign and posts knocked down' };
const access = () => {
  const me = session && session.name;
  const own = me === MVA.patroller, admin = !!(session && session.isAdmin), reviewer = me === 'Derek Melanson' || me === 'Jay Mcinnis';
  return { own, admin, view: own || admin || reviewer, edit: admin || (own && ['Open', 'Sent back'].includes(MVA.stage)) };
};
require.cache[mvaPath] = { id: mvaPath, filename: mvaPath, loaded: true, exports: { lib: {
  BASE: 'appMKaiabPAPx3JaV', FF, NOT_FOUND: { error: 'MVA not found' },
  loadOwned: async (id) => { if (id !== MVA.id) return null; const a = access(); return a.view ? Object.assign({}, MVA, { access: a }) : null; },
  canEdit: row => !!(row && row.access && row.access.edit),
  upsertItem: async (row, item, fields) => { ticks.push({ item, done: fields[FF.done], by: fields[FF.doneBy], notes: fields[FF.notes] }); return { id: 'recF' }; },
} } };
const handler = require(CLAIM);
const X = handler._test;

function call(method, body, query) {
  return new Promise(resolve => {
    const res = { _s: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this._s = s; return this; },
      json(j) { resolve({ status: this._s, json: j }); return this; }, end() { resolve({ status: this._s }); } };
    handler({ method, body, query: query || {}, headers: {} }, res).catch(e => resolve({ status: 'threw', json: { error: e.message } }));
  });
}
const S = (name, isAdmin) => ({ name, isAdmin: !!isAdmin });
const Q = { mva: 'recMVA0000000001' };
const save = (lines, third, notes) => call('POST', { mva: Q.mva, action: 'save', lines, third: third || [], notes });

(async () => {
  /* 1 — the math, against the coordinator's real invoice 2025-02-04-331 WB */
  let t = X.totalsOf([{ cat: 'site', rateId: 'r1', rate: 60, qty: 1 }, { cat: 'site', rateId: 'r2', rate: 35, qty: 1 }],
    [{ amount: 12533.13 }, { amount: 4848.28 }]);
  eq('331 WB: site response, repairs (third party), markup, admin, subtotal, HST, total',
    [t.site, t.repair, t.markup, t.admin, t.subtotal, t.hst, t.total], [95, 17381.41, 869.07, 873.82, 19219.3, 2882.9, 22102.2]);
  ok('…HST rounds half up on the half cent (2,882.895 → 2,882.90)', t.hst === 2882.9);
  t = X.totalsOf([{ cat: 'site', rateId: 'r', rate: 60, qty: 1 }], []);
  eq('a small invoice: administration is at least $150', [t.site, t.admin, t.subtotal, t.hst, t.total], [60, 150, 210, 31.5, 241.5]);
  t = X.totalsOf([], []);
  eq('an empty invoice: nothing at all (no $150 on nothing)', [t.admin, t.total], [0, 0]);
  t = X.totalsOf([{ cat: 'material', rateId: 'r', rate: 84.55, qty: 4 }, { cat: 'tc', rateId: 'r', rate: 150, qty: 1 }, { cat: 'repair', rateId: 'r', rate: 60, qty: 2.5 },
    { cat: 'site', rateId: '', rate: 0, qty: 3 }], []);
  eq('each part adds up; a line with no rate item yet is $0', [t.material, t.tc, t.repairLines, t.repair, t.site, t.markup], [338.2, 150, 150, 150, 0, 0]);
  eq('…markup is only on third-party invoices; admin 5% of the rest', t.admin, 150);
  eq('the rules travel with the totals', t.rules, { markupPct: 5, adminPct: 5, adminMin: 150, hstPct: 15 });

  /* 2 — reading it */
  session = null;
  eq('signed out: 401', (await call('GET', null, Q)).status, 401);
  session = S('James Rodey');
  eq('someone not on the file: 404', (await call('GET', null, Q)).status, 404);
  session = S('Tom Gibson');
  eq('a bad id: 404', (await call('GET', null, { mva: 'recNOPE' })).status, 404);
  AR = [{ id: 'recAR', fields: { fldK8gqs6PfZAXNs9: '2025-02-04-331.000-WB-AR', fldAIEl5C8asyAZzp: 'Tom Gibson', fld0Ehu0B9iUAuktz: '2104',
    fldQyKBFIpkFzAiiP: '2025-02-04T07:10:00.000Z', fld8jizpsetNlXvY6: '2025-02-04T08:25:00.000Z', fldVkA60qvqGoK9Zk: [{ name: 'First Aid Kit' }, { name: 'Spill Kit' }, { name: 'None' }],
    fldTskwroWMBDCjZq: 'K. Singh', fldqH8sRqUBMt8fdS: 'Northeast Haulers Inc.', fldZg4C3j0Ti6TkOT: '2015 Volvo', fld4cceVBAhLbaW9t: 'A 25670 (Alta)',
    flduMRNGlarwbFjnT: 'Nordic Insurance (Intact)', fld62DuTiuk1VsfJo: '761146456', fldNHYucsM2iU6YSG: 'Cst. Z. Vojnovic' } }];
  let r = await call('GET', null, Q);
  eq('the patroller opens it: empty, editable', [r.status, r.json.invoice.lines, r.json.invoice.complete, r.json.edit], [200, [], false, true]);
  eq('…active rates only, with the billed rate (rate × markup)', [r.json.rates.length, r.json.rates.find(x => x.id === 'recPst0000000001').rate, r.json.rates.some(x => x.item === 'Retired thing')], [7, 84.55, false]);
  eq('…the header from the MVA and the accident report', [r.json.header.driver, r.json.header.owner, r.json.header.plate, r.json.header.insurer, r.json.header.policy, r.json.header.officer, r.json.header.policeFile, r.json.header.km],
    ['K. Singh', 'Northeast Haulers Inc.', 'A 25670 (Alta)', 'Nordic Insurance (Intact)', '761146456', 'Cst. Z. Vojnovic', '2025-155693', 331]);
  const pf = r.json.prefill;
  eq('…starting lines: time at the scene (1 h 15 → 1.5 h), the truck, the items used', pf.map(l => [l.key, l.cat, l.item, l.qty, l.who]),
    [['ar:labour', 'site', 'Labour', 1.5, 'Tom Gibson'], ['ar:truck', 'site', 'Patrol Vehicle/Pick Up Truck', 1.5, 'Unit 2104'],
     ['ar:item:First Aid Kit', 'site', 'First Aid Kit', 1, ''], ['ar:item:Spill Kit', 'material', 'Spill Kit / Disposal Fee', 1, '']]);
  eq('…the scene hours: at least 1, up to the half hour', [X.sceneHours({ fldQyKBFIpkFzAiiP: '2025-01-01T10:00:00Z', fld8jizpsetNlXvY6: '2025-01-01T10:20:00Z' }),
    X.sceneHours({ fldQyKBFIpkFzAiiP: '2025-01-01T10:00:00Z', fld8jizpsetNlXvY6: '2025-01-01T12:01:00Z' }), X.sceneHours({})], [1, 2.5, null]);
  AR = [];
  r = await call('GET', null, Q);
  eq('no accident report yet: no starting lines, the header still has the MVA', [r.json.prefill.length, r.json.header.hasReport, r.json.header.route], [0, false, 'Route 2']);

  /* 3 — saving */
  const L1 = { key: 'ar:labour', cat: 'site', rateId: 'recLab0000000001', qty: 1, who: 'Tom Gibson', src: 'report' };
  const L2 = { key: 'ar:truck', cat: 'site', rateId: 'recTrk0000000001', qty: 1, who: 'Unit 2104', src: 'report' };
  const T1 = { key: 't1', vendor: 'K-Line Construction Ltd.', invoiceNo: '01-0056428', amount: 12533.13 };
  const T2 = { key: 't2', vendor: 'Dept of Transportation', invoiceNo: '40054434', amount: 4848.28 };
  r = await save([L1, L2], [T1, T2], 'K-Line provided their own traffic control during install.');
  eq('saved, with the totals', [r.status, r.json.invoice.totals.total, r.json.invoice.lines.map(l => [l.item, l.rate]), r.json.invoice.notes],
    [200, 22102.2, [['Labour', 60], ['Patrol Vehicle/Pick Up Truck', 35]], 'K-Line provided their own traffic control during install.']);
  const rec = Object.values(INV)[0];
  eq('…one row, keyed to the MVA, totals stored', [Object.keys(INV).length, rec.fields.fldG5BvvnH14yGk7u, rec.fields.fld1AL2ztQYNuwkbJ, rec.fields.fldquTkZmRQuMEHA2, rec.fields.fldQxiNKdSBPzikhO, rec.fields.fldS1Yrnas60enxUS],
    [1, '2025-02-04-331.000-WB', ['recMVA0000000001'], 22102.2, 2882.9, 873.82]);
  eq('…who and when', rec.fields.fldVsKPuvCN3jbBnA, 'Tom Gibson');
  RATES[0].fields.fldR5L3RYOiLXh6HX = 65;   // the rate sheet changes…
  r = await save([L1, L2], [T1, T2]);
  eq('a saved line keeps the rate it was added with', r.json.invoice.lines[0].rate, 60);
  r = await save([L1, L2, { key: 'm1', cat: 'site', rateId: 'recLab0000000001', qty: 2, who: 'Joshua Barker', src: 'timesheet', date: '2025-02-04' }], [T1, T2]);
  eq('…a new line takes today\'s rate', r.json.invoice.lines[2].rate, 65);
  RATES[0].fields.fldR5L3RYOiLXh6HX = 60;
  r = await save([L1, L2, { key: 'u1', cat: 'site', rateId: '', qty: 2, label: 'Unit 1234', who: 'Joshua Barker', src: 'timesheet' }], [T1, T2]);
  eq('a unit from the timesheets with no equipment type yet is kept at $0', [r.status, r.json.invoice.lines[2].rate, r.json.invoice.totals.site], [200, 0, 95]);
  ok('…and is listed as missing', r.json.missing.some(m => /Unit 1234 \(Joshua Barker\): pick what it was/.test(m)), JSON.stringify(r.json.missing));
  // what the page may not do
  for (const [label, lines, third, re] of [
    ['a rate from another part', [{ key: 'x', cat: 'tc', rateId: 'recLab0000000001', qty: 1 }], [], /belongs under Accident Site Response/],
    ['a retired rate', [{ key: 'x', cat: 'repair', rateId: 'recOld0000000001', qty: 1 }], [], /not on the rate sheet/],
    ['an unknown part', [{ key: 'x', cat: 'other', rateId: 'recLab0000000001', qty: 1 }], [], /which part/],
    ['a zero quantity', [{ key: 'x', cat: 'site', rateId: 'recLab0000000001', qty: 0 }], [], /more than 0/],
    ['a repeated line', [L1, L1], [], /repeated/],
    ['a bad key', [{ key: '<script>', cat: 'site', rateId: 'recLab0000000001', qty: 1 }], [], /bad key/],
    ['a negative invoice', [], [{ key: 't', vendor: 'X', amount: -5 }], /more than 0/],
    ['not a list', 'nope', [], /must be a list/],
  ]) { const x = await save(lines, third); ok('refused: ' + label, x.status === 400 && re.test(x.json.error), JSON.stringify(x.json)); }
  r = await save([L1, L2], [T1, T2]);

  /* 4 — third-party invoice files */
  r = await call('POST', { mva: Q.mva, action: 'file', filename: 'kline.pdf', contentType: 'application/pdf', data: 'JVBERi0=' });
  eq('a third-party invoice is attached', [r.status, uploads[0].fieldId, r.json.invoice.files.map(f => f.filename)], [200, 'fld93100j7kUUERJY', ['kline.pdf']]);
  r = await call('POST', { mva: Q.mva, action: 'file', filename: 'dot.pdf', contentType: 'application/pdf', data: 'JVBERi0=' });
  r = await call('POST', { mva: Q.mva, action: 'fileRemove', fileId: 'att2' });
  eq('…and can be removed', r.json.invoice.files.map(f => f.filename), ['kline.pdf']);
  eq('a file needs data', (await call('POST', { mva: Q.mva, action: 'file', filename: 'x.pdf' })).status, 400);

  /* 5 — Mark complete */
  ticks = [];
  await save([L1, { key: 'u1', cat: 'site', rateId: '', qty: 2, label: 'Unit 1234' }], [T1, Object.assign({}, T2, { amount: null })]);
  r = await call('POST', { mva: Q.mva, action: 'complete', done: true });
  ok('refused while a line is unpriced and an amount is missing', r.status === 409 && /Unit 1234: pick what it was/.test(r.json.error) && /Dept of Transportation\): the amount/.test(r.json.error), r.json.error);
  eq('…nothing ticked', ticks.length, 0);
  await save([L1, L2], [T1, T2]);
  r = await call('POST', { mva: Q.mva, action: 'complete', done: true });
  eq('complete: recorded', [r.status, r.json.invoice.complete, r.json.invoice.completedBy, r.json.missing], [200, true, 'Tom Gibson', []]);
  eq('…the folder\'s Claim invoice is ticked, with the total', [ticks[0].item, ticks[0].done, ticks[0].by, ticks[0].notes],
    ['Claim invoice', true, 'Tom Gibson', 'Total $22102.20 (subtotal $19219.30 + HST $2882.90)']);
  ticks = [];
  r = await save([L1, L2, { key: 'c1', cat: 'tc', rateId: 'recCon0000000001', qty: 1 }], [T1, T2]);
  eq('a change after completing reopens it and unticks the folder', [r.json.invoice.complete, ticks.map(x => [x.item, x.done])], [false, [['Claim invoice', false]]]);
  await call('POST', { mva: Q.mva, action: 'complete', done: true }); ticks = [];
  r = await call('POST', { mva: Q.mva, action: 'complete', done: false });
  eq('reopen by hand unticks it too', [r.json.invoice.complete, ticks.map(x => x.done)], [false, [false]]);
  // third-party invoices but no file
  INV[Object.keys(INV)[0]].fields.fld93100j7kUUERJY = [];
  r = await call('POST', { mva: Q.mva, action: 'complete', done: true });
  ok('third-party amounts with no invoice attached: refused', r.status === 409 && /Attach the third-party invoice/.test(r.json.error), r.json.error);
  await save([], []);
  r = await call('POST', { mva: Q.mva, action: 'complete', done: true });
  ok('an empty invoice: refused', r.status === 409 && /Nothing on the invoice/.test(r.json.error), r.json.error);
  await save([L1, L2], [T1, T2]);
  await call('POST', { mva: Q.mva, action: 'file', filename: 'k.pdf', contentType: 'application/pdf', data: 'JVBERi0=' });

  /* 6 — who may change it */
  session = S('Derek Melanson');
  r = await call('GET', null, Q);
  eq('the verifier reads it, read-only', [r.status, r.json.edit, r.json.invoice.totals.total], [200, false, 22102.2]);
  r = await save([L1], []);
  ok('…and cannot change it', r.status === 409 && /Only the patroller completes the invoice/.test(r.json.error), r.json.error);
  session = S('Tom Gibson'); MVA.stage = 'Awaiting verification';
  r = await save([L1], []);
  ok('submitted: the patroller cannot change it', r.status === 409 && /sent back to you/.test(r.json.error), r.json.error);
  r = await call('POST', { mva: Q.mva, action: 'complete', done: false });
  eq('…nor reopen it', r.status, 409);
  MVA.stage = 'Sent back';
  eq('sent back: he can again', (await save([L1, L2], [T1, T2])).status, 200);
  MVA.stage = 'With claims'; session = S('Troy Johnston', true);
  eq('an admin can at any stage', (await save([L1, L2], [T1, T2])).status, 200);
  eq('an unknown action: 400', (await call('POST', { mva: Q.mva, action: 'nope' })).status, 400);
  MVA.stage = 'Open';

  console.log(`\ntest-claim: ${pass} passed, ${fail} failed`);
  if (fail) { for (const f of failures) console.log('  FAIL ' + f); process.exit(1); }
})().catch(e => { console.log('HARNESS', e); process.exit(1); });
