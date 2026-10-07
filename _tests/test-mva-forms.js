// test-mva-forms.js — run with an ABSOLUTE path:
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
const ACC      = path.join(__dirname, '..', 'api', 'mva-forms.js');

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, x) => { if (c) pass++; else { fail++; failures.push(n + (x ? ` — ${x}` : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), `got ${JSON.stringify(g)} want ${JSON.stringify(w)}`);

const T = { mva: 'tblFnoVfyA9nSEOwk', folder: 'tbl9VS7Ggu8UKCeXU', ar: 'tblShwnpWGogKaZxG', sc: 'tblExJGXFCqLKPU2V', inv: 'tblA5YveLsiSYd98t' };
let DB, seq, uploads, writes;
let mails = [], SWMODE = 'Everyone';
const reset = () => { DB = { [T.mva]: {}, [T.folder]: {}, [T.ar]: {}, [T.sc]: {}, [T.inv]: {} }; seq = 0; uploads = []; writes = []; mails = []; };
const SELECTS = new Set(['fldgIA9dpSAllebrF', 'fldCbe3KQ2xm7Dgs3', 'fldypZa9PK1hyT6OU', 'fldS51U7n89nvnC3z', 'fldlnthwLcdTATYaF',
  'fldJSY1h0VeUp5akf', 'fldWdeQqgXx7ycBmo', 'fld0XMlrjJ5atFqoH', 'fldRa0KV1HJzLMOjH', 'fld5UhV73aQlRQk3W', 'fldSkexOw2KTCNEOo', 'fldnSafV7m2ll4Xf3']);
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
  if (table === 'tblUfWrGjHTHXszos') return { records: [['Tom Gibson', 'Derek Melanson'], ['Derek Melanson', ''], ['Michael Park', ''], ['Jay Mcinnis', '']]
    .map(([n, m], i) => ({ id: 'recE' + i, fields: { fldtLjh72SJV8Uyfb: n, fldBggHLMX7abWiSK: n.split(' ')[0].toLowerCase() + '@mrdc.ca', fld06i7CJWbkIbCZA: m } })) };
  if (table === 'tblN3F3YU9lg0K6Fz') return { records: [{ id: 'recR1', fields: { fldR6WX7zZziNhIEH: 'Operations Manager', fldcd2tacVtpOaA0P: 'Michael Park' } },
    { id: 'recR2', fields: { fldR6WX7zZziNhIEH: 'Claims Manager', fldcd2tacVtpOaA0P: 'Jay Mcinnis' } }] };
  const tb = DB[table];
  if (!tb) throw new Error('unknown table ' + table);
  if (m !== 'GET') writes.push({ table, m, byId });
  if (m === 'GET' && !id) {
    const f = url.searchParams.get('filterByFormula') || '';
    const mm = f.match(/^\{(.+?)\}='(.*)'$/);
    const field = mm && { 'Report No.': 'fldK8gqs6PfZAXNs9', 'Investigation No.': 'fldCNGwdH57csZuUV',
      'MVA No.': table === T.folder ? 'fldZ6jtW2k7LqxPe0' : table === T.sc ? 'fldgoMWeGAjnE1rDn' : 'flddJ5v5jZ9rv4VWg' }[mm[1]];
    return { records: Object.values(tb).filter(r => !field || r.fields[field] === mm[2]).map(r => answer(r, byId)) };
  }
  if (m === 'GET') { if (!tb[id]) { const e = new Error('NOT_FOUND'); e.status = 404; throw e; } return answer(tb[id], byId); }
  if (m === 'POST') { const rec = { id: 'rec' + table.slice(3, 5) + String(++seq).padStart(12, '0'), fields: Object.assign({}, body.fields) }; tb[rec.id] = rec; return answer(rec, byId); }
  if (m === 'PATCH') { Object.assign(tb[id].fields, body.fields); return answer(tb[id], byId); }
};
require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: {
  PAT: 'stub', airtable,
  EF: { name: 'fldtLjh72SJV8Uyfb', email: 'fldBggHLMX7abWiSK', active: 'fldcHPqfxScpuUbZ6' }, EMP_BASE: 'appraSoUXoTbhroG6', EMP_TABLE: 'tblUfWrGjHTHXszos',
  arr: x => (Array.isArray(x) ? x : x == null ? [] : [x]), sel: x => (x && x.name) || x || '',
  num: x => (x === '' || x == null ? undefined : Number(x)), esc: s => String(s == null ? '' : s),
  cors: () => false, parseBody: req => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})),
  getEmployees: async () => [], getPatrollers: async () => [], sendMail: async (o) => { mails.push(o); return o.to; }, sendMailDetailed: async () => ({}),
  uploadAttachment: async (o) => { uploads.push(o); const rec = DB[T.ar][o.recordId] || DB[T.inv][o.recordId]; (rec.fields[o.fieldId] = rec.fields[o.fieldId] || []).push({ id: 'att' + uploads.length, url: 'https://x/' + o.filename, filename: o.filename }); },
} };
require.cache[condPath] = { id: condPath, filename: condPath, loaded: true, exports: {
  switchFor: async (n) => ({ id: 'recSw', mode: n === 'MVA notification' ? SWMODE : 'Off' }),
  directory: async () => ({ people: [{ name: 'Troy Johnston', email: 'TJohnston@mrdc.ca', role: 'Owner', active: true }], lists: [] }),
  owners: d => d.people.filter(p => p.role === 'Owner').map(p => p.email), stampSwitch: async () => {} } };
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

const NOW = '2026-10-06T19:30:00.000Z';
(async () => {
  reset();
  session = S('Employee', 'Patroller', 'Tom Gibson');
  const mid = seedMva({ fldWIW6ejsJGjrMCM: true, fldgIA9dpSAllebrF: 'Western' });   // a hit & run

  /* 1 — Scene Clear */
  let r = await call('GET', null, { mva: mid, form: 'scene' });
  eq('scene clear: none yet, the patroller may file', [r.status, r.json.list, r.json.canFile], [200, [], true]);
  r = await call('POST', { mva: mid, form: 'scene', comments: 'Lanes open' });
  eq('the time it cleared is required', r.status, 400);
  r = await call('POST', { mva: mid, form: 'scene', time: NOW, comments: 'Lanes open', copyMe: true });
  eq('it saves, linked to the MVA', [r.status, r.json.list.length, Object.values(DB[T.sc])[0].fields.flda7zdk29u9LrHkn], [200, 1, [mid]]);
  eq('…emailed to the MVA distribution and a copy to the patroller (directory address)', mails[0] && mails[0].to, ['AccidentGroup2@mrdc.ca', 'tom@mrdc.ca']);
  ok('…the subject names the MVA and the time', /^MVA 2026-10-06-303\.000-EB — scene clear 16:30$/.test(mails[0].subject), mails[0].subject);
  eq('…and Notified records it', r.json.list[0].notified, 'AccidentGroup2@mrdc.ca, tom@mrdc.ca');
  r = await call('POST', { mva: mid, form: 'scene', time: '2026-10-06T20:00:00.000Z', comments: 'All clear' });
  eq('a second update is its own record, newest first, no copy', [r.json.list.map(x => x.comments), mails[1].to], [['All clear', 'Lanes open'], ['AccidentGroup2@mrdc.ca']]);
  SWMODE = 'Owner test'; mails = [];
  r = await call('POST', { mva: mid, form: 'scene', time: NOW });
  ok('Owner test: only the Owner gets it, marked [TEST]', mails.length === 1 && mails[0].to[0] === 'TJohnston@mrdc.ca' && /^\[TEST\]/.test(mails[0].subject));
  SWMODE = 'Everyone';

  /* 2 — Investigation */
  r = await call('GET', null, { mva: mid, form: 'investigation' });
  eq('investigation: none yet', [r.status, r.json.report, r.json.canEdit], [200, null, true]);
  r = await call('POST', { mva: mid, form: 'investigation', report: { units: 'Plow 12' } });
  const iv = r.json.report;
  eq('the first save makes the draft from the MVA', [iv.invNo, iv.status, iv.hitRun, iv.division, iv.units], ['2026-10-06-303.000-EB-INV', 'Draft', true, 'Western', 'Plow 12']);
  mails = [];
  r = await call('POST', { mva: mid, form: 'investigation', report: {}, submit: true });
  eq('submit with nothing: 400 naming what is needed', r.json.missing,
     ['Date verified', 'Verified by', 'Contact the RCMP (required for a hit & run)', 'Were facility assets damaged?', 'Describe the damages / comments']);
  ok('…nothing sent', !mails.length);
  r = await call('POST', { mva: mid, form: 'investigation', report: { dateVerified: '2026-10-07', verifiedBy: 'Tom Gibson', rcmp: true, officer: 'Cst. Roy',
    policeFile: 'F-22', facilityDamaged: 'Yes', comments: '3 pieces of guiderail' }, submit: true });
  eq('assets damaged: a photo is required', r.json.missing, ['Photos of the damages']);
  r = await call('POST', { mva: mid, form: 'investigation', action: 'photo', filename: 'gr.jpg', contentType: 'image/jpeg', data: 'eA==' });
  eq('the photo goes on the investigation', [uploads.slice(-1)[0].fieldId, r.json.report.photos.length], ['fldDVGx1LaJuf2HmO', 1]);
  r = await call('POST', { mva: mid, form: 'investigation', report: { facilityDamaged: 'Maybe' } });
  eq('a value not on the list is cleared', r.json.report.facilityDamaged, '');
  r = await call('POST', { mva: mid, form: 'investigation', report: { facilityDamaged: 'Yes' }, submit: true });
  eq('it submits', [r.status, r.json.report.status, r.json.report.submittedBy], [200, 'Submitted', 'Tom Gibson']);
  eq('…emailed to the distribution', mails[0] && mails[0].to, ['AccidentGroup2@mrdc.ca']);
  ok('…naming the hit & run, the officer and the file no.', /investigation report \(hit &amp; run\)|investigation report \(hit & run\)/.test(mails[0].subject) && /Cst\. Roy/.test(mails[0].html) && /F-22/.test(mails[0].html));
  r = await call('POST', { mva: mid, form: 'investigation', report: { comments: 'changed' } });
  eq('submitted: read-only to the patroller', r.status, 409);
  r = await call('GET', null, { mva: mid, form: 'investigation' });
  eq('…and the page is told so', r.json.canEdit, false);

  /* 3 — who may */
  session = S('Employee', 'Patroller', 'James Rodey');
  r = await call('GET', null, { mva: mid, form: 'scene' });
  eq('another patroller: 404', r.status, 404);
  session = S('Employee', 'Supervisor', 'Derek Melanson');
  r = await call('GET', null, { mva: mid, form: 'investigation' });
  eq('the verifier can read the investigation', [r.status, r.json.canEdit], [200, false]);
  r = await call('POST', { mva: mid, form: 'scene', time: NOW });
  eq('…but not send a scene clear', r.status, 403);
  session = S('Admin', 'Admin', 'Troy Johnston');
  r = await call('POST', { mva: mid, form: 'investigation', report: { comments: '3 pieces — corrected' } });
  eq('an admin can still correct a submitted one', [r.status, r.json.report.comments], [200, '3 pieces — corrected']);
  r = await call('GET', null, { mva: mid, form: 'nope' });
  eq('an unknown form: 400', r.status, 400);

  console.log(failures.map(f => '   FAIL  ' + f).join('\n'));
  console.log(`\ntest-mva-forms: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('HARNESS', e.stack); process.exit(1); });
