// test-accident.js — run with an ABSOLUTE path:
//   node <repo>/road-patrol-api/_tests/test-accident.js
// Zero dependencies; no browser, no network, no credentials.
//
// api/accident.js — the Accident Report + Proof of Repairs for an MVA (2026-10-06).
// One Accident Reports row per MVA (<MVA No.>-AR). Submitting ticks the folder's
// "Accident Report"; the proof of repairs ticks "Photos of the completed repairs".
// Injuries / Fatality are Yes / No / Unknown; Items Used by MRDC is the billable list.
// Real mva.js underneath (ownership, folder rows); a fake Airtable that answers by
// field NAME unless field ids are asked for, like the real one.

const path = require('path');
const Module = require('module');
const libPath  = path.join(__dirname, '..', 'api', '_lib.js');
const authPath = path.join(__dirname, '..', 'api', '_auth.js');
const condPath = path.join(__dirname, '..', 'api', '_conditions.js');
const ACC      = path.join(__dirname, '..', 'api', 'accident.js');

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, x) => { if (c) pass++; else { fail++; failures.push(n + (x ? ` — ${x}` : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), `got ${JSON.stringify(g)} want ${JSON.stringify(w)}`);

const T = { mva: 'tblFnoVfyA9nSEOwk', folder: 'tbl9VS7Ggu8UKCeXU', ar: 'tblShwnpWGogKaZxG' };
let DB, seq, uploads, writes;
const reset = () => { DB = { [T.mva]: {}, [T.folder]: {}, [T.ar]: {} }; seq = 0; uploads = []; writes = []; };
const SELECTS = new Set(['fldgIA9dpSAllebrF', 'fldCbe3KQ2xm7Dgs3', 'fldypZa9PK1hyT6OU', 'fldS51U7n89nvnC3z', 'fldlnthwLcdTATYaF',
  'fldJSY1h0VeUp5akf', 'fldWdeQqgXx7ycBmo', 'fld0XMlrjJ5atFqoH', 'fldRa0KV1HJzLMOjH']);
const MULTI = new Set(['fldVkA60qvqGoK9Zk', 'fldlNYDv5nAT6dAo0']);
function answer(rec, byId) {
  const f = {};
  for (const [k, v] of Object.entries(rec.fields)) {
    if (v == null) continue;
    f[byId ? k : 'name:' + k] = SELECTS.has(k) && typeof v === 'string' ? { id: 'sel', name: v } : MULTI.has(k) ? v.map(n => ({ id: 'sel', name: n })) : v;
  }
  return { id: rec.id, createdTime: '2026-10-06T00:00:00.000Z', fields: f };
}
const airtable = async (p, opt = {}) => {
  const url = new URL('https://api.airtable.com/v0/' + p);
  const body = opt.body ? JSON.parse(opt.body) : null;
  const byId = url.searchParams.get('returnFieldsByFieldId') === 'true' || !!(body && body.returnFieldsByFieldId);
  const m = (opt.method || 'GET').toUpperCase();
  const [, , , table, id] = url.pathname.split('/');
  const tb = DB[table];
  if (!tb) throw new Error('unknown table ' + table);
  if (m !== 'GET') writes.push({ table, m, byId });
  if (m === 'GET' && !id) {
    const f = url.searchParams.get('filterByFormula') || '';
    const mm = f.match(/^\{(.+?)\}='(.*)'$/);
    const field = mm && { 'Report No.': 'fldK8gqs6PfZAXNs9', 'MVA No.': table === T.folder ? 'fldZ6jtW2k7LqxPe0' : 'flddJ5v5jZ9rv4VWg' }[mm[1]];
    return { records: Object.values(tb).filter(r => !field || r.fields[field] === mm[2]).map(r => answer(r, byId)) };
  }
  if (m === 'GET') { if (!tb[id]) { const e = new Error('NOT_FOUND'); e.status = 404; throw e; } return answer(tb[id], byId); }
  if (m === 'POST') { const rec = { id: 'rec' + table.slice(3, 5) + String(++seq).padStart(12, '0'), fields: Object.assign({}, body.fields) }; tb[rec.id] = rec; return answer(rec, byId); }
  if (m === 'PATCH') { Object.assign(tb[id].fields, body.fields); return answer(tb[id], byId); }
};
require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: {
  PAT: 'stub', airtable,
  arr: x => (Array.isArray(x) ? x : x == null ? [] : [x]), sel: x => (x && x.name) || x || '',
  num: x => (x === '' || x == null ? undefined : Number(x)), esc: s => String(s == null ? '' : s),
  cors: () => false, parseBody: req => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})),
  getEmployees: async () => [], getPatrollers: async () => [], sendMail: async () => [], sendMailDetailed: async () => ({}),
  uploadAttachment: async (o) => { uploads.push(o); const rec = DB[T.ar][o.recordId]; (rec.fields[o.fieldId] = rec.fields[o.fieldId] || []).push({ id: 'att' + uploads.length, url: 'https://x/' + o.filename, filename: o.filename }); },
} };
require.cache[condPath] = { id: condPath, filename: condPath, loaded: true, exports: {
  switchFor: async () => ({ id: null, mode: 'Off' }), directory: async () => ({ people: [], lists: [] }), owners: () => [], stampSwitch: async () => {} } };
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (r, ...rest) {
  if (r === './_lib') return libPath; if (r === './_auth') return authPath; if (r === './_conditions') return condPath;
  return origResolve.call(this, r, ...rest);
};
let session = null;
global.fetch = async () => (session ? { ok: true, status: 200, json: async () => session } : { ok: false, status: 401, json: async () => ({}) });
const S = (orgRole, appRole, name) => ({ ok: true, allowed: true, appRole, apps: ['Patrol'], user: { name, email: 'x@mrdc.ca', role: orgRole, source: 'employee', employeeId: 'recE' } });

const handler = require(ACC);
async function call(method, body, query) {
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, setHeader() {}, end() { return this; } };
  await handler({ method, headers: { cookie: 'htra_session=x' }, query: query || {}, body }, res);
  return { status, json };
}
function seedMva(o) {
  const id = 'recMVA' + String(Object.keys(DB[T.mva]).length + 1).padStart(11, '0');
  DB[T.mva][id] = { id, fields: Object.assign({ flddJ5v5jZ9rv4VWg: '2026-10-06-303.000-EB', fld52QNBDHZQfx5za: 'Tom Gibson', fldXlKWDYku5DvKJB: 'Tom Gibson',
    fld9iwXIi9fetqCjI: true }, o || {}) };
  return id;
}
const FULL = { patroller: 'Tom Gibson', division: 'Western', timeOfAccident: '2026-10-06T16:56:00.000Z', route: 'Route 2', km: 303,
  direction: 'EB', vehicles: 2, injuries: 'Unknown', fatality: 'No', roadCond: 'Wet', weather: 'Rain', damages: '10 pieces of guiderail' };

(async () => {
  reset();
  session = S('Employee', 'Patroller', 'Tom Gibson');
  const mid = seedMva();

  /* 1 — nothing yet */
  let r = await call('GET', null, { mva: mid });
  eq('the patroller opens it: no report yet', [r.status, r.json.report], [200, null]);
  eq('…Injuries/Fatality offer Unknown', r.json.choices.ynu, ['Yes', 'No', 'Unknown']);
  eq('…and the billable items', r.json.choices.items, ['None', 'Signs', 'First Aid Kit', 'Spill Kit', 'Fire Extinguisher']);

  /* 2 — save a draft */
  r = await call('POST', { mva: mid, report: { truck: 'P-12', injuries: 'Unknown', items: ['Signs', 'Spill Kit', 'Bogus'], km: '303.25', ramp: 'OFF Ramp', hitRun: true } });
  const rep = r.json.report;
  eq('the first save creates the draft, numbered off the MVA', [rep.reportNo, rep.status, rep.startedBy], ['2026-10-06-303.000-EB-AR', 'Draft', 'Tom Gibson']);
  eq('…linked to the MVA, with its trigger', [Object.values(DB[T.ar])[0].fields.fldD01RPTQaqHh5aT, Object.values(DB[T.ar])[0].fields.fldlNYDv5nAT6dAo0], [[mid], ['Damages to facility']]);
  eq('…Unknown is kept', rep.injuries, 'Unknown');
  eq('…only listed items are kept', rep.items, ['Signs', 'Spill Kit']);
  eq('…km as a number, the ramp, hit & run', [rep.km, rep.ramp, rep.hitRun], [303.25, 'OFF Ramp', true]);
  ok('every write asks for field ids', writes.every(w => w.byId), JSON.stringify(writes));
  r = await call('POST', { mva: mid, report: { weather: 'Rain' } });
  eq('a second save updates the same report', Object.keys(DB[T.ar]).length, 1);
  eq('…and keeps the first save', [r.json.report.truck, r.json.report.weather], ['P-12', 'Rain']);
  r = await call('POST', { mva: mid, report: { injuries: 'Maybe', division: 'Northern' } });
  eq('values not on the lists are ignored', [r.json.report.injuries, r.json.report.division], ['Unknown', '']);

  /* 3 — submit */
  r = await call('POST', { mva: mid, report: {}, submit: true });
  eq('submit with fields missing: 400', r.status, 400);
  ok('…naming them', /Division/.test(r.json.error) && /Description of damages/.test(r.json.error), r.json.error);
  ok('…the folder is not ticked', !Object.keys(DB[T.folder]).length);
  r = await call('POST', { mva: mid, report: FULL, submit: true });
  eq('a complete report submits', [r.status, r.json.report.status, r.json.report.submittedBy], [200, 'Submitted', 'Tom Gibson']);
  const fr = Object.values(DB[T.folder])[0];
  eq('…and ticks the folder\'s Accident Report', [fr && fr.fields.fldLCZxKhdozk8fhk, fr && fr.fields.fldUjL1uELhKd5O3P, fr && fr.fields.fldv9yBGj0fMQglnx],
     ['Accident Report', true, 'Tom Gibson']);
  r = await call('POST', { mva: mid, report: { officer: 'Cst. Smith' } });
  eq('it can still be added to after submitting', [r.json.report.officer, r.json.report.status], ['Cst. Smith', 'Submitted']);

  /* 4 — photos */
  r = await call('POST', { mva: mid, action: 'photo', kind: 'licence', filename: 'dl.jpg', contentType: 'image/jpeg', data: 'eA==' });
  eq('a licence photo goes to its field', [uploads[0].fieldId, r.json.report.photos.licence.map(p => p.filename)], ['fld3jQnLxu5n5ggO2', ['dl.jpg']]);
  r = await call('POST', { mva: mid, action: 'photo', kind: 'nope', data: 'eA==' });
  eq('an unknown photo kind: 400', r.status, 400);
  r = await call('POST', { mva: mid, action: 'photoRemove', kind: 'licence', fileId: 'att1' });
  eq('…and can be removed', r.json.report.photos.licence.length, 0);

  /* 5 — proof of repairs */
  r = await call('POST', { mva: mid, repairs: { date: '2026-10-15', notes: 'Replaced 10 pieces' }, repairsDone: true });
  eq('repairs done without a photo: 400', [r.status, /repair photo/.test(r.json.error)], [400, true]);
  await call('POST', { mva: mid, action: 'photo', kind: 'repair', filename: 'fixed.jpg', contentType: 'image/jpeg', data: 'eA==' });
  r = await call('POST', { mva: mid, repairsDone: true });
  eq('with the date and a photo it completes', [r.status, r.json.report.repairsDone, r.json.report.repairDate, r.json.report.repairNotes],
     [200, true, '2026-10-15', 'Replaced 10 pieces']);
  ok('…and ticks "Photos of the completed repairs"', Object.values(DB[T.folder]).some(x => x.fields.fldLCZxKhdozk8fhk === 'Photos of the completed repairs' && x.fields.fldUjL1uELhKd5O3P));

  /* 6 — who may */
  session = S('Employee', 'Patroller', 'James Rodey');
  r = await call('GET', null, { mva: mid });
  eq('another patroller: 404', r.status, 404);
  r = await call('POST', { mva: mid, report: { truck: 'X' } });
  eq('…cannot write it either', [r.status, Object.values(DB[T.ar])[0].fields.fld0Ehu0B9iUAuktz], [404, 'P-12']);
  session = S('Admin', 'Admin', 'Troy Johnston');
  r = await call('GET', null, { mva: mid });
  eq('a supervisor opens it', [r.status, r.json.report.reportNo], [200, '2026-10-06-303.000-EB-AR']);
  DB[T.mva][mid].fields.fldIUbZxpDiRFY4VC = '2026-10-20';
  session = S('Employee', 'Patroller', 'Tom Gibson');
  r = await call('POST', { mva: mid, report: { truck: 'Y' } });
  eq('filed with insurance: closed to the patroller', r.status, 409);
  session = S('Admin', 'Admin', 'Troy Johnston');
  r = await call('POST', { mva: mid, report: { truck: 'Y' } });
  eq('…a supervisor can still correct it', [r.status, r.json.report.truck], [200, 'Y']);

  console.log(failures.map(f => '   FAIL  ' + f).join('\n'));
  console.log(`\ntest-accident: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('HARNESS', e.stack); process.exit(1); });
