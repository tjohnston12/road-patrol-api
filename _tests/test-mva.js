// test-mva.js — run with an ABSOLUTE path:
//   node <repo>/road-patrol-api/_tests/test-mva.js
// Zero dependencies; no browser, no network, no credentials.
//
// POST /api/mva — the MVA Notification. Written 2026-10-06 after Troy's first
// live test MVA (2026-10-06-303.000-EB):
//   1. The notification email went out with the subject "MVA" and an empty
//      body. The create call did not ask Airtable for field IDs, Airtable
//      answered by field NAME, and shape() — which reads by ID — saw nothing.
//      The page's success screen showed a blank MVA No. for the same reason.
//      The fake Airtable below answers by NAME unless returnFieldsByFieldId is
//      sent, exactly like the real one, so the bug cannot come back unseen.
//   2. Troy: "the patroller should get the email, they need to build and
//      complete the accident file folder". The patroller is copied — address
//      from the Employees directory by name, never from the request — and the
//      email lists the folder when an accident report is required.

const path = require('path');
const Module = require('module');

const libPath  = path.join(__dirname, '..', 'api', '_lib.js');
const authPath = path.join(__dirname, '..', 'api', '_auth.js');
const MVA      = path.join(__dirname, '..', 'api', 'mva.js');
const condPath = path.join(__dirname, '..', 'api', '_conditions.js');

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, x) => { if (c) pass++; else { fail++; failures.push(n + (x ? ` — ${x}` : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), `got ${JSON.stringify(g)} want ${JSON.stringify(w)}`);

// Field id -> name, for the fields this exercises (from the live schema).
const NAMES = {
  flddJ5v5jZ9rv4VWg: 'MVA No.', fldyNaXuFj9LTbelQ: 'Occurred At', fld8dDEK0xlJqPUzS: 'Date',
  fld52QNBDHZQfx5za: 'Patroller', fldlCV1Cyknry8KQf: 'Patroller Email', fldgIA9dpSAllebrF: 'Division',
  fldCbe3KQ2xm7Dgs3: 'Route', fld6p5ivQNf8K0BSV: 'KM', fldypZa9PK1hyT6OU: 'Direction',
  fld9iwXIi9fetqCjI: 'Damages to Facility', fldFKDBopABcL4M6B: 'Damage Description',
  fldDZGvitTgzAtNcX: 'Highway Blocked', fld75MhzYB29Rhmqw: 'Spill', fldrqnH2ujA493AGT: 'Dept of Environment Called',
  fldNRjvZEFolYv9uq: 'Status', fldCFjoigjFgQwuv5: 'Notification Sent At', fld2uqP1UINkICedW: 'Notified',
  fldCZCNzveE8f62gi: 'Accident Report Required', fldd0JXy6NKliOKAd: 'Investigation Required',
  fldWIW6ejsJGjrMCM: 'Hit & Run', fld2h81Yn4jpfQUAz: 'Fatality', fldP4p8salI5YRkwU: 'Extensive Traffic Control',
  fldQBjjZNYPVpUaaW: 'Summary', fldD7oUvWiKXgp8pJ: 'Lanes Blocked',
};
const SELECTS = ['fldgIA9dpSAllebrF', 'fldCbe3KQ2xm7Dgs3', 'fldypZa9PK1hyT6OU', 'fldNRjvZEFolYv9uq', 'fldD7oUvWiKXgp8pJ'];

let DB = {}, writes = [], mails = [], DIR = [], seq = 0;
function answer(rec, byId) {
  const f = Object.assign({}, rec.fields);
  f.fldCZCNzveE8f62gi = (f.fld9iwXIi9fetqCjI || f.fld2h81Yn4jpfQUAz || f.fldP4p8salI5YRkwU) ? 'Yes' : 'No';
  f.fldd0JXy6NKliOKAd = f.fldWIW6ejsJGjrMCM ? 'Yes' : 'No';
  for (const k of SELECTS) if (typeof f[k] === 'string') f[k] = { id: 'sel' + k, name: f[k] };
  const out = {};
  for (const [k, v] of Object.entries(f)) out[byId ? k : (NAMES[k] || k)] = v;
  return { id: rec.id, createdTime: '2026-10-06T16:58:20.000Z', fields: out };
}
const T_MVA = 'tblFnoVfyA9nSEOwk', T_FOLDER = 'tbl9VS7Ggu8UKCeXU';
let FOLDER_DB = {}, fseq = 0, uploads = [], AR_RECS = [];
// The Employees directory and MVA File Roles, as the route reads them.
let EMP = [{ name: 'Tom Gibson', email: 'tgibson@mrdc.ca', manager: 'Derek Melanson' }, { name: 'Derek Melanson', email: 'oromocto@mrdc.ca' },
  { name: 'Michael Park', email: 'mpark@mrdc.ca' }, { name: 'Jay Mcinnis', email: 'jmcinnis@mrdc.ca' }, { name: 'James Rodey', email: 'jrodey@mrdc.ca', manager: 'Derek Melanson' }];
let ROLES = [['Operations Manager', 'Michael Park'], ['Claims Manager', 'Jay Mcinnis']];
const airtable = async (p, opt = {}) => {
  const url = new URL('https://api.airtable.com/v0/' + p);
  const body = opt.body ? JSON.parse(opt.body) : null;
  const byId = url.searchParams.get('returnFieldsByFieldId') === 'true' || !!(body && body.returnFieldsByFieldId);
  const m = (opt.method || 'GET').toUpperCase();
  const [, , , table, id] = url.pathname.split('/');
  if (table === 'tblUfWrGjHTHXszos') return { records: EMP.map((e, i) => ({ id: 'recE' + i, fields: { fldtLjh72SJV8Uyfb: e.name, fldBggHLMX7abWiSK: e.email,
    fldcHPqfxScpuUbZ6: { name: 'Active' }, fld06i7CJWbkIbCZA: e.manager || '' } })) };
  if (table === 'tblN3F3YU9lg0K6Fz') return { records: ROLES.map((r, i) => ({ id: 'recR' + i, fields: { fldR6WX7zZziNhIEH: r[0], fldcd2tacVtpOaA0P: r[1] } })) };
  if (table === 'tblShwnpWGogKaZxG') return { records: AR_RECS };
  if (table === T_FOLDER) {                                            // the folder rows: always asked for by id
    if (!byId) throw new Error('folder read/write without returnFieldsByFieldId');
    writes.push({ m, byId, table: 'folder' });
    if (m === 'GET') { const f = url.searchParams.get('filterByFormula') || ''; const want = (f.match(/='(.*)'$/) || [])[1];
      return { records: Object.values(FOLDER_DB).filter(r => !want || r.fields.fldZ6jtW2k7LqxPe0 === want).map(r => JSON.parse(JSON.stringify(r))) }; }
    if (m === 'POST') { const rec = { id: 'recF' + String(++fseq).padStart(13, '0'), fields: body.fields }; FOLDER_DB[rec.id] = rec; return rec; }
    if (m === 'PATCH') { Object.assign(FOLDER_DB[id].fields, body.fields); return FOLDER_DB[id]; }
  }
  if (m === 'GET' && !id) {
    const f = url.searchParams.get('filterByFormula') || '';
    if (/\{MVA No\.\}/.test(f)) return { records: [] };                 // uniqueMvaNo: no clash
    return { records: Object.values(DB).map(r => answer(r, byId)) };    // the list (scoping is Airtable's formula)
  }
  if (m === 'POST') { writes.push({ m, byId, typecast: !!(body && body.typecast) }); const rec = { id: 'recM' + String(++seq).padStart(13, '0'), fields: body.fields }; DB[rec.id] = rec; return answer(rec, byId); }
  if (m === 'PATCH') { writes.push({ m, byId, fields: Object.keys(body.fields) }); Object.assign(DB[id].fields, body.fields); return answer(DB[id], byId); }
  if (m === 'GET') { if (!DB[id]) { const e = new Error('NOT_FOUND'); e.status = 404; throw e; } return answer(DB[id], byId); }
  throw new Error('unexpected ' + m);
};
require.cache[libPath] = {
  id: libPath, filename: libPath, loaded: true, exports: {
    PAT: 'stub-pat', airtable,
    EF: { name: 'fldtLjh72SJV8Uyfb', email: 'fldBggHLMX7abWiSK', active: 'fldcHPqfxScpuUbZ6' }, EMP_BASE: 'appraSoUXoTbhroG6', EMP_TABLE: 'tblUfWrGjHTHXszos',
    arr: x => (Array.isArray(x) ? x : x == null ? [] : [x]),
    sel: x => (x && x.name) || x || '',
    num: x => (x === '' || x == null ? undefined : Number(x)),
    esc: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    cors: () => false,
    parseBody: req => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})),
    getEmployees: async () => DIR, getPatrollers: async () => DIR,
    uploadAttachment: async (o) => { uploads.push(o); const r = FOLDER_DB[o.recordId]; if (r) (r.fields.fldX1QOIze3KlNiT1 = r.fields.fldX1QOIze3KlNiT1 || []).push({ id: 'att' + uploads.length, url: 'https://x/' + o.filename, filename: o.filename }); return ''; },
    sendMail: async (o) => { mails.push(o); return Array.isArray(o.to) ? o.to : String(o.to).split(','); },
    sendMailDetailed: async () => ({ sent: [], reason: '' }),
  },
};
// The Patrol Notifications switch. Most cases run as Everyone; section 7 runs
// Owner test / Off / unreadable — Owner test is how it is set while Troy tests.
let SW = { id: 'recSwMva', mode: 'Everyone' }, WF = { id: 'recSwWf', mode: 'Everyone' }, SW_THROWS = false, stamps = [];
require.cache[condPath] = { id: condPath, filename: condPath, loaded: true, exports: {
  switchFor: async (name) => { if (SW_THROWS) throw new Error('Airtable 503'); return name === 'MVA notification' ? SW : name === 'MVA file workflow' ? WF : { id: null, mode: 'Off' }; },
  directory: async () => ({ people: [{ name: 'Troy Johnston', email: 'TJohnston@mrdc.ca', role: 'Owner', active: true }], lists: [] }),
  owners: dir => dir.people.filter(p => p.role === 'Owner').map(p => p.email),
  stampSwitch: async (sw, result) => { stamps.push({ sw, result }); },
} };
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (r, ...rest) {
  if (r === './_lib') return libPath;
  if (r === './_auth') return authPath;
  if (r === './_conditions') return condPath;
  return origResolve.call(this, r, ...rest);
};

let session = null;
global.fetch = async () => (session
  ? { ok: true, status: 200, json: async () => session }
  : { ok: false, status: 401, json: async () => ({ ok: false }) });
const S = (orgRole, appRole, name) => ({ ok: true, allowed: true, appRole, apps: ['Patrol'],
  user: { name, email: 'x@mrdc.ca', role: orgRole, source: 'employee', employeeId: 'recEmp1' } });

delete process.env.MVA_NOTIFY_TO;
const handler = require(MVA);
async function call(method, body, query) {
  let status = 200, json = null;
  const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; },
    setHeader() {}, end() { return this; } };
  await handler({ method, headers: { cookie: 'htra_session=x', origin: 'https://www.mrdc-htra.com' }, query: query || {}, body }, res);
  return { status, json };
}
const reset = () => { DB = {}; writes = []; mails = []; seq = 0; FOLDER_DB = {}; fseq = 0; uploads = []; AR_RECS = []; };
const BASE_MVA = { date: '2026-10-06', occurredAt: '2026-10-06T16:56:00.000Z', km: 303, direction: 'EB', route: 'Route 2',
  division: 'Western', patroller: 'Tom Gibson', vehicles: 2, damages: true, damageDesc: 'guiderail hit 10 pieces', summary: 'test entry' };

(async () => {
  session = S('Employee', 'Patroller', 'Tom Gibson');
  DIR = [{ name: 'Tom Gibson', email: 'tgibson@mrdc.ca' }, { name: 'Troy Johnston', email: 'TJohnston@mrdc.ca' }];

  /* 1 — the record reads back: the bug that sent "MVA" with an empty body */
  reset();
  let r = await call('POST', { ...BASE_MVA, patrollerEmail: 'someone@else.com' });
  eq('filed', r.status, 200);
  eq('the response carries the MVA No.', r.json.row && r.json.row.mvaNo, '2026-10-06-303.000-EB');
  ok('every Airtable write asks for field IDs', writes.length >= 2 && writes.every(w => w.byId), JSON.stringify(writes));
  const m = mails[0] || {};
  ok('the subject names the MVA', /^MVA 2026-10-06-303\.000-EB — Damages to facility$/.test(m.subject || ''), m.subject);
  ok('the body carries the number, route and km', /2026-10-06-303\.000-EB/.test(m.html) && /Route 2 · km 303\.000 · EB/.test(m.html), '');
  ok('…and the patroller and damage', /Tom Gibson/.test(m.html) && /guiderail hit 10 pieces/.test(m.html));
  ok('…and says an accident report is required', /An accident report is required/.test(m.html));

  /* 2 — the patroller gets it, from the directory */
  eq('to the Accident Group and the patroller', m.to, ['AccidentGroup2@mrdc.ca', 'tgibson@mrdc.ca']);
  ok('the address in the request is ignored', !JSON.stringify(m.to).includes('someone@else.com'));
  eq('the record keeps the directory address', DB[Object.keys(DB)[0]].fields.fldlCV1Cyknry8KQf, 'tgibson@mrdc.ca');
  eq('Notified lists both', r.json.row.notified, 'AccidentGroup2@mrdc.ca, tgibson@mrdc.ca');
  eq('the page is told two recipients', r.json.emailedTo.length, 2);

  /* 3 — the accident file folder */
  ok('the email lists the accident file folder', /Accident file folder — 2026-10-06-303\.000-EB/.test(m.html));
  for (const item of ['Accident Report', 'Accident Claim Work Summary', 'Accident photos and damages', 'Photos of the completed repairs',
                      'Traffic control sheets', 'Copy of the time sheets', 'Accident Claim Checklist'])
    ok(`…including ${item}`, m.html.includes(item));
  ok('…and names who builds it', /Tom Gibson builds and completes the folder/.test(m.html));

  reset();
  r = await call('POST', { ...BASE_MVA, damages: false, damageDesc: '', blocked: true });
  ok('no accident report needed: no folder', !/Accident file folder/.test((mails[0] || {}).html || ''));
  eq('…and the subject flags the blocked highway', (mails[0] || {}).subject, 'MVA 2026-10-06-303.000-EB — Highway blocked');

  /* 4 — names the directory does not have */
  reset();
  r = await call('POST', { ...BASE_MVA, patroller: 'Visiting Patroller' });
  eq('a name not in the directory: the group only', (mails[0] || {}).to, ['AccidentGroup2@mrdc.ca']);
  reset();
  r = await call('POST', { ...BASE_MVA, patroller: '  tom gibson ' });
  eq('the name match ignores case and spaces', (mails[0] || {}).to, ['AccidentGroup2@mrdc.ca', 'tgibson@mrdc.ca']);
  reset();
  DIR = [{ name: 'Tom Gibson', email: 'accidentgroup2@MRDC.ca' }];
  r = await call('POST', BASE_MVA);
  eq('an address already on the list is not sent twice', (mails[0] || {}).to, ['AccidentGroup2@mrdc.ca']);
  DIR = [{ name: 'Tom Gibson', email: 'tgibson@mrdc.ca' }];

  /* 5 — the spill gate still refuses before anything is written or sent */
  reset();
  r = await call('POST', { ...BASE_MVA, spill: true, doeCalled: false });
  eq('spill without Dept. of Environment: 400', r.status, 400);
  ok('…nothing written, nothing sent', !writes.length && !mails.length);

  /* 6 — a supervisor's status change reads back too */
  reset();
  r = await call('POST', BASE_MVA);
  const filedId = r.json.row.id;
  session = S('Admin', 'Admin', 'Troy Johnston');
  const before = writes.length;
  r = await call('PATCH', { id: filedId, status: 'Repairs pending' });
  eq('status change answers with the new status', r.json.row && r.json.row.status, 'Repairs pending');
  ok('…asking for field IDs', writes.slice(before).every(w => w.byId) && writes.length > before);
  eq('…and the MVA No. still reads', r.json.row && r.json.row.mvaNo, '2026-10-06-303.000-EB');

  /* 6b — Lanes blocked: Ramp (2026-10-06) */
  session = S('Employee', 'Patroller', 'Tom Gibson');
  reset(); let lastBody = null;
  r = await call('GET', null, { meta: '1' });
  ok('Ramp is offered for lanes blocked', (r.json.choices.lanes || []).includes('Ramp'), JSON.stringify(r.json.choices.lanes));
  reset();
  r = await call('POST', { ...BASE_MVA, damages: false, blocked: true, lanes: 'Ramp' });
  eq('Ramp is saved', DB[r.json.row.id].fields.fldD7oUvWiKXgp8pJ, 'Ramp');
  eq('…and flagged in the subject', (mails[0] || {}).subject, 'MVA 2026-10-06-303.000-EB — Highway blocked — Ramp');
  ok('the create lets Airtable add the choice on first use (typecast)', writes[0] && writes[0].typecast === true);
  reset();
  r = await call('POST', { ...BASE_MVA, damages: false, blocked: true, lanes: 'Somewhere else' });
  ok('a lanes value not on the list is dropped', !('fldD7oUvWiKXgp8pJ' in DB[r.json.row.id].fields));

  /* 7 — the switch: Owner test while Troy tests */
  session = S('Employee', 'Patroller', 'Tom Gibson');
  reset(); stamps = []; SW = { id: 'recSwMva', mode: 'Owner test' };
  r = await call('POST', BASE_MVA);
  eq('Owner test: one email', mails.length, 1);
  eq('…to the Owner only', (mails[0] || {}).to, ['TJohnston@mrdc.ca']);
  ok('…marked [TEST]', /^\[TEST\] MVA 2026-10-06-303\.000-EB/.test((mails[0] || {}).subject || ''), (mails[0] || {}).subject);
  ok('…naming who it would have reached', /would have gone to: AccidentGroup2@mrdc\.ca, tgibson@mrdc\.ca/.test((mails[0] || {}).html || ''));
  ok('…with the full notification below', /Accident file folder/.test((mails[0] || {}).html || ''));
  ok('Notified says it was a test and who it would have reached',
     /^Owner test — sent to TJohnston@mrdc\.ca; would have gone to AccidentGroup2@mrdc\.ca, tgibson@mrdc\.ca$/.test(r.json.row.notified), r.json.row.notified);
  eq('the page is told the mode', r.json.mode, 'Owner test');
  ok('the switch is stamped', stamps.length === 1 && /^2026-10-06-303\.000-EB: Owner test/.test(stamps[0].result));

  reset(); SW = { id: 'recSwMva', mode: 'Off' };
  r = await call('POST', BASE_MVA);
  ok('Off: nothing sent, the MVA still saved', !mails.length && r.status === 200 && r.json.row.mvaNo === '2026-10-06-303.000-EB');
  ok('…Notified says so', /^Off — not sent; would have gone to/.test(r.json.row.notified));
  ok('…and no sent time', !r.json.row.notifiedAt);

  reset(); SW_THROWS = true;
  r = await call('POST', BASE_MVA);
  ok('switch unreadable: treated as Off, MVA still saved', !mails.length && r.status === 200 && /^Off/.test(r.json.row.notified));
  SW_THROWS = false; SW = { id: 'recSwMva', mode: 'Everyone' };

  /* 8 — the accident file folder (patrol/mvas.html), 2026-10-06 */
  SW = { id: 'recSwMva', mode: 'Everyone' };
  session = S('Employee', 'Patroller', 'Tom Gibson');
  reset();
  r = await call('POST', BASE_MVA);
  const mid = r.json.row.id;
  ok('the email links to the folder', (mails[0] || {}).html.includes('mvas.html?id=' + mid));
  r = await call('GET', null, { id: mid });
  eq('the patroller opens their MVA', r.status, 200);
  eq('…with the seven folder items, none done', [r.json.folder.total, r.json.folder.done, r.json.folder.items.map(i => i.item)],
     [7, 0, ['Accident Report', 'Accident Claim Work Summary', 'Accident photos and damages', 'Photos of the completed repairs',
             'Traffic control sheets', 'Copy of the time sheets', 'Accident Claim Checklist']]);
  r = await call('GET', null, {});
  eq('the list carries folder progress', [r.json.rows.length, r.json.rows[0].folderDone, r.json.rows[0].folderTotal], [1, 0, 7]);

  session = S('Employee', 'Patroller', 'James Rodey');
  r = await call('GET', null, { id: mid });
  eq('another patroller: 404', r.status, 404);
  r = await call('POST', { action: 'folder', id: mid, item: 'Accident Report', done: true });
  eq('…cannot tick their folder', r.status, 404);
  r = await call('POST', { action: 'upload', id: mid, data: 'eA==', filename: 'x.jpg' });
  eq('…cannot add photos to their MVA', r.status, 404);
  r = await call('PATCH', { id: mid, dmtWo: 'WO-1' });
  eq('…cannot set the DMT work order', r.status, 404);
  r = await call('GET', null, { id: 'not-a-record' });
  eq('a malformed id: 404', r.status, 404);
  session = S('Admin', 'Admin', 'Troy Johnston');
  r = await call('GET', null, { id: mid });
  eq('a supervisor opens anyone\'s', r.status, 200);

  session = S('Employee', 'Patroller', 'Tom Gibson');
  r = await call('POST', { action: 'folder', id: mid, item: 'Something else', done: true });
  eq('an unknown item: 400', r.status, 400);
  r = await call('POST', { action: 'folder', id: mid, item: 'Accident Report', done: true, notes: 'Driver statement attached' });
  const ar = r.json.folder.items[0];
  ok('ticking an item records who and when', ar.done && ar.doneBy === 'Tom Gibson' && !!ar.doneAt, JSON.stringify(ar));
  eq('…and the notes', ar.notes, 'Driver statement attached');
  eq('…one row, keyed to the MVA', Object.values(FOLDER_DB).map(x => [x.fields.fld0beeAYR8nhCJX7, x.fields.fldgBEhKPojKUDyiq]),
     [['2026-10-06-303.000-EB · Accident Report', [mid]]]);
  r = await call('POST', { action: 'folder', id: mid, item: 'Accident Report', done: false });
  ok('unticking clears who and when', !r.json.folder.items[0].done && !r.json.folder.items[0].doneBy);
  eq('…still one row', Object.keys(FOLDER_DB).length, 1);
  r = await call('POST', { action: 'folderFile', id: mid, item: 'Traffic control sheets', data: 'JVBERi0=', filename: 'tc.pdf', contentType: 'application/pdf' });
  eq('a file goes onto that item\'s row', [uploads.length, uploads[0] && uploads[0].fieldId, r.json.folder.items[4].files.map(f => f.filename)],
     [1, 'fldX1QOIze3KlNiT1', ['tc.pdf']]);
  r = await call('POST', { action: 'folderFileRemove', id: mid, item: 'Traffic control sheets', fileId: 'att1' });
  eq('…and can be removed', r.json.folder.items[4].files.length, 0);

  /* 9 — the route (2026-10-06): patroller → manager verifies → Operations Manager
     approves → Claims Manager files with insurance → paid. Send back at any step. */
  const P = (step, extra) => call('PATCH', Object.assign({ id: mid, step }, extra || {}));
  r = await P('submit');
  eq('submit with the folder incomplete: 409', r.status, 409);
  ok('…names the items and the photos', (r.json.missing || []).length === 9 && /Photos of the accident/.test(r.json.error) && /Photos of the completed repairs \(at least one\)/.test(r.json.error), r.json.error);
  for (const it of ['Accident Report', 'Accident Claim Work Summary', 'Accident photos and damages', 'Photos of the completed repairs',
                    'Traffic control sheets', 'Copy of the time sheets', 'Accident Claim Checklist'])
    await call('POST', { action: 'folder', id: mid, item: it, done: true });
  r = await P('submit');
  eq('every item ticked but no photos: still 409', [r.status, (r.json.missing || []).length], [409, 2]);
  await call('POST', { action: 'folderFile', id: mid, item: 'Accident photos and damages', data: 'eA==', filename: 'scene.jpg', contentType: 'image/jpeg' });
  r = await P('submit');
  ok('an accident photo but no repair photo: still 409', r.status === 409 && /completed repairs/.test(r.json.error) && !/accident and damages/.test(r.json.error));
  AR_RECS = [{ id: 'recAR', fields: { fldK8gqs6PfZAXNs9: '2026-10-06-303.000-EB-AR', fldmEpRePHQOxRBkv: [{ id: 'attR', url: 'https://x/fixed.jpg', filename: 'fixed.jpg', type: 'image/jpeg' }] } }];
  r = await call('GET', null, { id: mid });
  eq('the file carries who approves and who handles claims', r.json.roles, { ops: 'Michael Park', claims: 'Jay Mcinnis' });
  eq('the photos panel gathers every photo in the file', [r.json.photos.accident, r.json.photos.repair, r.json.photos.list.map(p => p.source)],
     [1, 1, ['Accident report — repairs', 'Folder — Accident photos and damages']]);
  mails = [];
  session = S('Employee', 'Patroller', 'James Rodey');
  r = await P('submit');
  eq('another patroller cannot submit it', r.status, 404);
  session = S('Employee', 'Patroller', 'Tom Gibson');
  r = await P('submit');
  eq('the patroller submits', [r.status, r.json.row.stage, r.json.row.fileSubmittedBy, r.json.row.verifier], [200, 'Awaiting verification', 'Tom Gibson', 'Derek Melanson']);
  eq('…the verifier (his manager) is emailed', [mails.length, mails[0] && mails[0].to], [1, ['oromocto@mrdc.ca']]);
  ok('…with a link to the file', /mvas\.html\?id=/.test((mails[0] || {}).html || ''));
  r = await call('POST', { action: 'folder', id: mid, item: 'Accident Report', done: false });
  eq('submitted: the patroller can no longer change the folder', r.status, 409);
  r = await P('verify');
  eq('…nor verify it himself', r.status, 403);

  session = S('Employee', 'Supervisor', 'Michael Park');
  r = await P('approve');
  eq('the approver cannot approve before it is verified', r.status, 409);
  r = await P('verify');
  eq('…nor verify for the patroller\'s manager', r.status, 403);
  session = S('Employee', 'Supervisor', 'Derek Melanson');
  r = await call('GET', null, {});
  eq('the manager sees it in his list, asked to verify', r.json.rows.map(x => [x.mvaNo, x.access.action]), [['2026-10-06-303.000-EB', 'verify']]);
  r = await call('POST', { action: 'folder', id: mid, item: 'Accident Report', done: false });
  eq('…he cannot change the folder (he sends it back instead)', r.status, 409);
  r = await P('sendBack', { note: '' });
  eq('sending back needs a note', r.status, 400);
  mails = [];
  r = await P('sendBack', { note: 'No photo of the guiderail ends' });
  eq('he sends it back', [r.status, r.json.row.stage, r.json.row.sentBackNote], [200, 'Sent back', 'No photo of the guiderail ends']);
  eq('…the patroller is emailed', mails[0] && mails[0].to, ['tgibson@mrdc.ca']);
  ok('…and it is in the history', /Derek Melanson — sent back: No photo of the guiderail ends/.test(r.json.row.history));
  session = S('Employee', 'Patroller', 'Tom Gibson');
  r = await call('POST', { action: 'folder', id: mid, item: 'Accident Claim Checklist', notes: 'Added the ends' });
  eq('sent back: the patroller can change it again', r.status, 200);
  r = await P('submit');
  eq('…and resubmit (the note is cleared)', [r.json.row.stage, r.json.row.sentBackNote], ['Awaiting verification', '']);

  session = S('Employee', 'Supervisor', 'Derek Melanson');
  mails = [];
  r = await P('verify');
  eq('the manager verifies', [r.status, r.json.row.stage, r.json.row.verifiedBy], [200, 'Awaiting approval', 'Derek Melanson']);
  eq('…the Operations Manager is emailed', mails[0] && mails[0].to, ['mpark@mrdc.ca']);
  session = S('Employee', 'User', 'Jay Mcinnis');
  r = await P('approve');
  eq('the claims manager cannot approve', r.status, 403);
  session = S('Employee', 'Supervisor', 'Michael Park');
  mails = [];
  r = await P('approve');
  eq('Mike Park approves', [r.status, r.json.row.stage, r.json.row.approvedBy], [200, 'With claims', 'Michael Park']);
  eq('…the Claims Manager is emailed', mails[0] && mails[0].to, ['jmcinnis@mrdc.ca']);
  r = await P('filed', { filed: { date: '2026-10-20', insurer: 'Intact' } });
  eq('only the claims manager files it', r.status, 403);

  session = S('Employee', 'User', 'Jay Mcinnis');
  r = await call('GET', null, { id: mid });
  eq('the claims manager opens it, asked to file', [r.status, r.json.row.access.action], [200, 'file']);
  r = await P('paid', { paid: { date: '2026-11-01' } });
  eq('paid before filed: 409', r.status, 409);
  r = await P('filed', { filed: { date: '2026-10-20', insurer: '' } });
  eq('filing needs the insurer', r.status, 400);
  r = await P('filed', { filed: { date: '2026-10-20', insurer: 'Intact', claimNo: 'C-1' } });
  eq('he files it with the insurer', [r.status, r.json.row.stage, r.json.row.filedInsurer, r.json.row.claimNo, r.json.row.filedBy],
     [200, 'Filed with insurance', 'Intact', 'C-1', 'Jay Mcinnis']);
  r = await P('paid', { paid: { date: '2026-11-01', amount: '4210.55' } });
  eq('…and records the payment', [r.status, r.json.row.stage, r.json.row.paidDate, r.json.row.paidAmount], [200, 'Paid', '2026-11-01', 4210.55]);
  ok('the history reads in order', /submitted[\s\S]*sent back[\s\S]*submitted[\s\S]*verified[\s\S]*approved[\s\S]*filed with Intact \(claim C-1\)[\s\S]*payment received \$4210\.55/.test(r.json.row.history), r.json.row.history);

  /* 10 — email through the workflow switch */
  reset(); stamps = []; WF = { id: 'recSwWf', mode: 'Owner test' };
  session = S('Employee', 'Patroller', 'Tom Gibson');
  r = await call('POST', BASE_MVA); const m2 = r.json.row.id; mails = [];
  for (const it of ['Accident Report', 'Accident Claim Work Summary', 'Accident photos and damages', 'Photos of the completed repairs',
                    'Traffic control sheets', 'Copy of the time sheets', 'Accident Claim Checklist'])
    await call('POST', { action: 'folder', id: m2, item: it, done: true });
  await call('POST', { action: 'folderFile', id: m2, item: 'Accident photos and damages', data: 'eA==', filename: 'a.jpg', contentType: 'image/jpeg' });
  await call('POST', { action: 'folderFile', id: m2, item: 'Photos of the completed repairs', data: 'eA==', filename: 'b.jpg', contentType: 'image/jpeg' });
  AR_RECS = [];
  mails = [];
  r = await call('PATCH', { id: m2, step: 'submit' });
  eq('Owner test: the step email goes to the Owner only', [r.status, mails.length, mails[0] && mails[0].to], [200, 1, ['TJohnston@mrdc.ca']]);
  ok('…marked [TEST], naming who it was for', /^\[TEST\]/.test(mails[0].subject) && /oromocto@mrdc\.ca/.test(mails[0].html));
  WF = { id: 'recSwWf', mode: 'Everyone' };
  EMP = EMP.map(e => e.name === 'Tom Gibson' ? Object.assign({}, e, { manager: '' }) : e);
  reset(); r = await call('POST', BASE_MVA);
  r = await call('GET', null, { id: r.json.row.id });
  eq('no manager on file: the Operations Manager verifies', r.json.row.verifier, 'Michael Park');
  EMP = EMP.map(e => e.name === 'Tom Gibson' ? Object.assign({}, e, { manager: 'Derek Melanson' }) : e);

  console.log(failures.map(f => '   FAIL  ' + f).join('\n'));
  console.log(`\ntest-mva: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('HARNESS', e.stack); process.exit(1); });
