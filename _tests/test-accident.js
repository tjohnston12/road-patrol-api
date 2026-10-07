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

const T = { mva: 'tblFnoVfyA9nSEOwk', folder: 'tbl9VS7Ggu8UKCeXU', ar: 'tblShwnpWGogKaZxG', veh: 'tblpMfPIXMJhFmuuw' };
let DB, seq, uploads, writes;
const reset = () => { DB = { [T.mva]: {}, [T.folder]: {}, [T.ar]: {}, [T.veh]: {} }; seq = 0; uploads = []; writes = []; };
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
  if (table === 'tblUfWrGjHTHXszos') return { records: [['Tom Gibson', 'Derek Melanson'], ['Derek Melanson', ''], ['Michael Park', ''], ['Jay Mcinnis', '']]
    .map(([n, m], i) => ({ id: 'recE' + i, fields: { fldtLjh72SJV8Uyfb: n, fldBggHLMX7abWiSK: n.split(' ')[0].toLowerCase() + '@mrdc.ca', fld06i7CJWbkIbCZA: m } })) };
  if (table === 'tblN3F3YU9lg0K6Fz') return { records: [{ id: 'recR1', fields: { fldR6WX7zZziNhIEH: 'Operations Manager', fldcd2tacVtpOaA0P: 'Michael Park' } },
    { id: 'recR2', fields: { fldR6WX7zZziNhIEH: 'Claims Manager', fldcd2tacVtpOaA0P: 'Jay Mcinnis' } }] };
  const tb = DB[table];
  if (!tb) throw new Error('unknown table ' + table);
  if (m !== 'GET') writes.push({ table, m, byId });
  if (m === 'GET' && !id) {
    const f = url.searchParams.get('filterByFormula') || '';
    const fm = f.match(/^FIND\('(.*)',\{Vehicle Ref\}\)=1$/);
    if (fm) return { records: Object.values(tb).filter(r => String(r.fields.fldwfUp29kQs8NQI7 || '').indexOf(fm[1]) === 0).map(r => answer(r, byId)) };
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
  EF: { name: 'fldtLjh72SJV8Uyfb', email: 'fldBggHLMX7abWiSK', active: 'fldcHPqfxScpuUbZ6' }, EMP_BASE: 'appraSoUXoTbhroG6', EMP_TABLE: 'tblUfWrGjHTHXszos',
  arr: x => (Array.isArray(x) ? x : x == null ? [] : [x]), sel: x => (x && x.name) || x || '',
  num: x => (x === '' || x == null ? undefined : Number(x)), esc: s => String(s == null ? '' : s),
  cors: () => false, parseBody: req => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})),
  getEmployees: async () => [], getPatrollers: async () => [], sendMail: async () => [], sendMailDetailed: async () => ({}),
  uploadAttachment: async (o) => { uploads.push(o); const rec = DB[T.ar][o.recordId] || DB[T.veh][o.recordId]; (rec.fields[o.fieldId] = rec.fields[o.fieldId] || []).push({ id: 'att' + uploads.length, url: 'https://x/' + o.filename, filename: o.filename }); },
} };
require.cache[condPath] = { id: condPath, filename: condPath, loaded: true, exports: {
  switchFor: async () => ({ id: null, mode: 'Off' }), directory: async () => ({ people: [], lists: [] }), owners: () => [], stampSwitch: async () => {} } };
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (r, ...rest) {
  if (r === './_lib') return libPath; if (r === './_auth') return authPath; if (r === './_conditions') return condPath;
  return origResolve.call(this, r, ...rest);
};
let session = null;
// Environment Canada (api.weather.gc.ca swob-realtime), faked: stations along the corridor.
let WX = { down: false, calls: [] };
const T0 = Date.now() - 2 * 3600e3;                 // "the accident", two hours ago
const iso = ms => new Date(ms).toISOString();
const STN = { sussex: ['SUSSEX FOUR CORNERS', 'MSC', -65.529, 45.742], moncton: ['Moncton/Greater Moncton Romeo Le', 'NAV CANADA', -64.679, 46.116],
  fred: ['Fredericton', 'NAV CANADA', -66.537, 45.869] };
const wxObs = (stn, ms, extra, id) => ({ id: id || `x-${stn}-${ms}-swob.xml`, geometry: { coordinates: [STN[stn][2], STN[stn][3], 30] },
  properties: Object.assign({ 'stn_nam-value': STN[stn][0], 'data_pvdr-value': STN[stn][1], obs_date_tm: iso(ms), 'date_tm-value': iso(ms),
    url: `https://dd.weather.gc.ca/x/${stn}-${ms}.xml`, air_temp: 2.7, dwpt_temp: 1.1, rel_hum: 89, avg_wnd_spd_10m_pst10mts: 5.3,
    avg_wnd_dir_10m_pst10mts: 221, max_wnd_spd_10m_pst1hr: 11, pcpn_amt_pst1hr: 0.4 }, extra || {}) });
const WX_FEATURES = () => [
  wxObs('sussex', T0 - 60 * 60e3, { air_temp: 9 }),
  wxObs('sussex', T0 - 4 * 60e3),
  wxObs('sussex', T0 - 1 * 60e3, { air_temp: 99 }, 'x-CASF-AUTO-minute-swob.xml'),       // minute report: skipped
  wxObs('moncton', T0 - 5 * 60e3, { air_temp: 3.9, vis: 24.14, avg_wnd_spd_10m_pst2mts: 15.1, avg_wnd_dir_10m_pst2mts: 239, 'data_attrib_not-value': 'Observational data provided by NAV CANADA. All rights reserved.' }),
  wxObs('fred', T0 + 3 * 60e3, { air_temp: 2.4, avg_vis_pst10mts: 16.09, snw_dpth: 6 }),
];
global.fetch = async (url) => {
  if (String(url).includes('api.weather.gc.ca')) {
    WX.calls.push(String(url));
    if (WX.down) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ type: 'FeatureCollection', features: WX_FEATURES() }) };
  }
  return (session ? { ok: true, status: 200, json: async () => session } : { ok: false, status: 401, json: async () => ({}) });
};
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
  direction: 'EB', vehicles: 1, injuries: 'Unknown', fatality: 'No', roadCond: 'Wet', weather: 'Rain', damages: '10 pieces of guiderail' };

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
  /* 3b — the photos it needs (Troy: plate — truck and trailer if there is one — licence,
     insurance card, in addition to the damage) */
  const photo = (kind, name) => call('POST', { mva: mid, action: 'photo', kind, filename: name, contentType: 'image/jpeg', data: 'eA==' });
  r = await call('POST', { mva: mid, report: Object.assign({}, FULL, { hitRun: false }), submit: true });
  eq('all fields but no photos: 400 naming the four photos', [r.status, r.json.missing],
     [400, ['Photos of the accident and damages', "Photo of the driver's licence", 'Photo of the licence plate', 'Photo of the insurance card']]);
  await photo('accident', 'scene.jpg'); await photo('licence', 'dl.jpg'); await photo('plate', 'plate.jpg');
  r = await call('POST', { mva: mid, report: { hasTrailer: true }, submit: true });
  eq('with a trailer the trailer plate is needed too', r.json.missing, ["Photo of the trailer's licence plate", 'Photo of the insurance card']);
  r = await call('POST', { mva: mid, report: { hitRun: true }, submit: false });
  r = await call('POST', { mva: mid, report: {}, submit: true });
  eq('a hit & run needs only the damage photos', [r.status, r.json.report.status], [200, 'Submitted']);
  DB[T.ar][Object.keys(DB[T.ar])[0]].fields.fldRa0KV1HJzLMOjH = 'Draft';
  for (const k of Object.keys(DB[T.folder])) delete DB[T.folder][k];
  await call('POST', { mva: mid, report: { hitRun: false } });
  await photo('trailer', 'trailer.jpg'); await photo('insurance', 'card.jpg');
  eq('the trailer plate goes to its own field', uploads.slice(-2)[0].fieldId, 'fldWb06wd1RE8uuiq');
  r = await call('POST', { mva: mid, report: FULL, submit: true });
  eq('a complete report submits', [r.status, r.json.report.status, r.json.report.submittedBy], [200, 'Submitted', 'Tom Gibson']);
  const fr = Object.values(DB[T.folder])[0];
  eq('…and ticks the folder\'s Accident Report', [fr && fr.fields.fldLCZxKhdozk8fhk, fr && fr.fields.fldUjL1uELhKd5O3P, fr && fr.fields.fldv9yBGj0fMQglnx],
     ['Accident Report', true, 'Tom Gibson']);
  r = await call('POST', { mva: mid, report: { officer: 'Cst. Smith' } });
  eq('it can still be added to after submitting', [r.json.report.officer, r.json.report.status], ['Cst. Smith', 'Submitted']);

  /* 4 — photos */
  r = await call('POST', { mva: mid, action: 'photo', kind: 'licence', filename: 'dl2.jpg', contentType: 'image/jpeg', data: 'eA==' });
  const lic = r.json.report.photos.licence;
  eq('a second licence (another vehicle) is added beside the first', [uploads.slice(-1)[0].fieldId, r.json.report.photos.licence.map(p => p.filename)], ['fld3jQnLxu5n5ggO2', ['dl.jpg', 'dl2.jpg']]);
  r = await call('POST', { mva: mid, action: 'photo', kind: 'nope', data: 'eA==' });
  eq('an unknown photo kind: 400', r.status, 400);
  r = await call('POST', { mva: mid, action: 'photoRemove', kind: 'licence', fileId: lic[0].id });
  eq('…and one can be removed (the other kept)', r.json.report.photos.licence.map(p => p.id), [lic[1].id]);

  /* 5 — proof of repairs */
  r = await call('POST', { mva: mid, repairs: { date: '2026-10-15', notes: 'Replaced 10 pieces' }, repairsDone: true });
  eq('repairs done without a photo: 400', [r.status, /repair photo/.test(r.json.error)], [400, true]);
  await call('POST', { mva: mid, action: 'photo', kind: 'repair', filename: 'fixed.jpg', contentType: 'image/jpeg', data: 'eA==' });
  r = await call('POST', { mva: mid, repairsDone: true });
  eq('with the date and a photo it completes', [r.status, r.json.report.repairsDone, r.json.report.repairDate, r.json.report.repairNotes],
     [200, true, '2026-10-15', 'Replaced 10 pieces']);
  ok('…and ticks "Photos of the completed repairs"', Object.values(DB[T.folder]).some(x => x.fields.fldLCZxKhdozk8fhk === 'Photos of the completed repairs' && x.fields.fldUjL1uELhKd5O3P));

  /* 5b — two vehicles (Troy, 2026-10-07: "when there is more than one vehicle involved,
     there will need to be two sets of drivers and vehicle info gathered") */
  DB[T.ar][Object.keys(DB[T.ar])[0]].fields.fldRa0KV1HJzLMOjH = 'Draft';
  r = await call('POST', { mva: mid, report: { vehicles: 2, extraVehicles: [{ n: 2 }] } });
  eq('the count goes to 2: no empty vehicle 2 is made', [r.status, Object.keys(DB[T.veh]).length, r.json.report.extraVehicles], [200, 0, []]);
  r = await call('POST', { mva: mid, report: {}, submit: true });
  eq('submit asks for vehicle 2\'s photos, named by vehicle', [r.status, r.json.missing],
     [400, ["Vehicle 2: Photo of the driver's licence", 'Vehicle 2: Photo of the licence plate', 'Vehicle 2: Photo of the insurance card']]);
  r = await call('POST', { mva: mid, report: { extraVehicles: [{ n: 2, driver: 'Ann Leger', plate: 'NB ABC 123', hasTrailer: true, bogus: 'x', id: 'recX', photos: {} }, { n: 11, driver: 'Too many' }, { n: 1, driver: 'Not here' }] } });
  const v2 = Object.values(DB[T.veh]);
  eq('vehicle 2 is saved to its own row, linked and numbered', v2.map(v => [v.fields.fldwfUp29kQs8NQI7, v.fields.fld7fXDhTxP7HC637[0] === Object.keys(DB[T.ar])[0], v.fields.fldCOloDspNrByuT7, v.fields.fldrsCPZRY84m6vr7, v.fields.fldSrbIaByRSsdc6x]),
     [['2026-10-06-303.000-EB-AR-V2', true, 2, 'Ann Leger', true]]);
  eq('…vehicle 1 on the report is left alone; 11 is ignored', [Object.values(DB[T.ar])[0].fields.fldTskwroWMBDCjZq || '', Object.keys(DB[T.veh]).length], ['', 1]);
  eq('…and it comes back with the report', [r.json.report.extraVehicles.length, r.json.report.extraVehicles[0].n, r.json.report.extraVehicles[0].driver, r.json.report.extraVehicles[0].plate], [1, 2, 'Ann Leger', 'NB ABC 123']);
  const nw = writes.length;
  await call('POST', { mva: mid, report: { extraVehicles: [{ n: 2, driver: 'Ann Leger' }] } });
  ok('an unchanged vehicle is not written again', !writes.slice(nw).some(w => w.table === T.veh), JSON.stringify(writes.slice(nw)));
  const vphoto = (kind, name, n) => call('POST', { mva: mid, action: 'photo', kind, vehicle: n, filename: name, contentType: 'image/jpeg', data: 'eA==' });
  r = await vphoto('licence', 'dl-v2.jpg', 2);
  eq('a vehicle 2 photo goes to its row, not the report', [uploads.slice(-1)[0].recordId === v2[0].id, uploads.slice(-1)[0].fieldId, r.json.report.extraVehicles[0].photos.licence.map(p => p.filename), r.json.report.photos.licence.length],
     [true, 'fld8jYrCXrGqsSm9N', ['dl-v2.jpg'], 1]);
  r = await vphoto('accident', 'x.jpg', 2);
  eq('damage photos are not per vehicle: 400', r.status, 400);
  r = await vphoto('licence', 'x.jpg', 12);
  eq('an unknown vehicle: 400', r.status, 400);
  await vphoto('plate', 'p-v2.jpg', 2); await vphoto('insurance', 'i-v2.jpg', 2);
  r = await call('POST', { mva: mid, report: {}, submit: true });
  eq('vehicle 2 has a trailer: its trailer plate is needed', r.json.missing, ["Vehicle 2: Photo of the trailer's licence plate"]);
  r = await vphoto('trailer', 't-v2.jpg', 2);
  eq('…which goes to its trailer field', uploads.slice(-1)[0].fieldId, 'fldQWeXpFVddoF5FS');
  r = await call('POST', { mva: mid, report: {}, submit: true });
  eq('both vehicles complete: it submits', [r.status, r.json.report.status], [200, 'Submitted']);
  const pid = r.json.report.extraVehicles[0].photos.plate[0].id;
  r = await call('POST', { mva: mid, action: 'photoRemove', kind: 'plate', vehicle: 2, fileId: pid });
  eq('a vehicle 2 photo can be removed', r.json.report.extraVehicles[0].photos.plate, []);
  r = await call('POST', { mva: mid, report: { vehicles: 3 }, submit: true });
  ok('three vehicles: vehicle 3 is asked for too', r.json.missing.includes("Vehicle 3: Photo of the driver's licence") && r.json.missing.includes('Vehicle 2: Photo of the licence plate'), JSON.stringify(r.json.missing));
  r = await call('POST', { mva: mid, report: { vehicles: 3, hitRun: true }, submit: true });
  eq('a hit & run still needs only the damage photos', r.status, 200);
  await call('POST', { mva: mid, report: { vehicles: 1, hitRun: false } });

  /* 5c — official weather (Troy: "Can we link a weather app to record official conditions at the time?") */
  DB[T.mva][mid].fields.fldusfufZWR2nTR6U = '45.75, -65.40';          // GPS near Sussex
  await call('POST', { mva: mid, report: { timeOfAccident: '' } });
  delete DB[T.mva][mid].fields.fldyNaXuFj9LTbelQ;
  r = await call('POST', { mva: mid, action: 'weather' });
  ok('no time of accident: says to enter it', r.status === 400 && /time of the accident/.test(r.json.error), JSON.stringify(r.json));
  await call('POST', { mva: mid, report: { timeOfAccident: iso(T0) } });
  WX.calls = [];
  r = await call('POST', { mva: mid, action: 'weather' });
  const w = r.json.report;
  eq('it records the nearest station\'s report closest to the time', [r.status, w.officialWeatherStation, w.officialWeatherAt], [200, 'SUSSEX FOUR CORNERS', iso(T0 - 4 * 60e3)]);
  ok('…as a plain summary', /^Environment and Climate Change Canada observation — SUSSEX FOUR CORNERS \(MSC\)/.test(w.officialWeather)
     && /4 min before the accident/.test(w.officialWeather) && /km from the scene \(GPS\)/.test(w.officialWeather)
     && /Temperature 2\.7 °C, dew point 1\.1 °C, humidity 89%/.test(w.officialWeather) && /Wind from SW 5 km\/h, gusting 11 km\/h/.test(w.officialWeather)
     && /Precipitation in the past hour 0\.4 mm/.test(w.officialWeather), w.officialWeather);
  ok('…not the minute report', !/99/.test(w.officialWeather));
  eq('…with a link to the original record', w.officialWeatherUrl, `https://dd.weather.gc.ca/x/sussex-${T0 - 4 * 60e3}.xml`);
  ok('it asks for the hour around the accident in the corridor', WX.calls.length === 1 && /bbox=-67\.3%2C45\.3%2C-64\.0%2C46\.6/.test(WX.calls[0])
     && WX.calls[0].includes(encodeURIComponent(iso(T0 - 75 * 60e3).replace(/\.\d+Z$/, 'Z'))), WX.calls[0]);
  DB[T.mva][mid].fields.fldusfufZWR2nTR6U = '';
  await call('POST', { mva: mid, report: { division: 'Eastern' } });
  r = await call('POST', { mva: mid, action: 'weather' });
  ok('no GPS, Eastern division: Moncton, said so', r.json.report.officialWeatherStation === 'Moncton/Greater Moncton Romeo Le'
     && /no GPS — the Eastern division's airport was used/.test(r.json.report.officialWeather) && /Visibility 24\.1 km/.test(r.json.report.officialWeather)
     && /Wind from WSW 15 km\/h/.test(r.json.report.officialWeather) && /NAV CANADA\. All rights reserved/.test(r.json.report.officialWeather), r.json.report.officialWeather);
  await call('POST', { mva: mid, report: { division: 'Western' } });
  r = await call('POST', { mva: mid, action: 'weather' });
  ok('no GPS, Western: Fredericton, after the accident, with snow', r.json.report.officialWeatherStation === 'Fredericton' && /3 min after the accident/.test(r.json.report.officialWeather)
     && /Snow on the ground 6 cm/.test(r.json.report.officialWeather), r.json.report.officialWeather);
  WX.down = true;
  r = await call('POST', { mva: mid, action: 'weather' });
  ok('Environment Canada down: says so, keeps what was recorded', /did not answer/.test(r.json.error) && Object.values(DB[T.ar])[0].fields.fldOwrXAOQ3iqRVhh === 'Fredericton', JSON.stringify(r.json));
  WX.down = false;
  await call('POST', { mva: mid, report: { timeOfAccident: iso(Date.now() - 40 * 864e5) } });
  WX.calls = [];
  r = await call('POST', { mva: mid, action: 'weather' });
  ok('older than 30 days: points to the historical data', r.status === 404 && /climate\.weather\.gc\.ca/.test(r.json.error) && !WX.calls.length, JSON.stringify(r.json));
  /* on submit, if never fetched */
  const arid = Object.keys(DB[T.ar])[0];
  Object.assign(DB[T.ar][arid].fields, { fldMXyqLpqpBMpAjR: null, fldOwrXAOQ3iqRVhh: null, fldRa0KV1HJzLMOjH: 'Draft' });
  DB[T.mva][mid].fields.fldusfufZWR2nTR6U = '45.75, -65.40';
  r = await call('POST', { mva: mid, report: { timeOfAccident: iso(T0), hitRun: true }, submit: true });
  eq('submit records the official weather if nobody did', [r.status, r.json.report.officialWeatherStation], [200, 'SUSSEX FOUR CORNERS']);
  Object.assign(DB[T.ar][arid].fields, { fldMXyqLpqpBMpAjR: null, fldOwrXAOQ3iqRVhh: null, fldRa0KV1HJzLMOjH: 'Draft' });
  WX.down = true;
  r = await call('POST', { mva: mid, report: {}, submit: true });
  eq('…and still submits when Environment Canada is down', [r.status, r.json.report.status, r.json.report.officialWeather], [200, 'Submitted', '']);
  WX.down = false;
  r = await call('POST', { mva: mid, report: { officialWeather: 'sunny, trust me', officialWeatherStation: 'X' } });
  eq('the official weather cannot be typed over', r.json.report.officialWeather, '');
  await call('POST', { mva: mid, report: { hitRun: false } });

  /* 6 — who may */
  session = S('Employee', 'Patroller', 'James Rodey');
  r = await call('GET', null, { mva: mid });
  eq('another patroller: 404', r.status, 404);
  r = await call('POST', { mva: mid, report: { truck: 'X' } });
  eq('…cannot write it either', [r.status, Object.values(DB[T.ar])[0].fields.fld0Ehu0B9iUAuktz], [404, 'P-12']);
  session = S('Admin', 'Admin', 'Troy Johnston');
  r = await call('GET', null, { mva: mid });
  eq('a supervisor opens it', [r.status, r.json.report.reportNo], [200, '2026-10-06-303.000-EB-AR']);
  session = S('Employee', 'Supervisor', 'Derek Melanson');
  r = await call('GET', null, { mva: mid });
  eq('the patroller\'s manager (the verifier) can read it', [r.status, r.json.canEdit], [200, false]);
  r = await call('POST', { mva: mid, report: { truck: 'Z' } });
  eq('…but not change it', r.status, 409);
  DB[T.mva][mid].fields.fldelaGXvgjkSNxpH = 'Awaiting verification';
  session = S('Employee', 'Patroller', 'Tom Gibson');
  r = await call('POST', { mva: mid, report: { truck: 'Y' } });
  eq('submitted for verification: closed to the patroller', [r.status, /sent back to you/.test(r.json.error)], [409, true]);
  DB[T.mva][mid].fields.fldelaGXvgjkSNxpH = 'Sent back';
  r = await call('POST', { mva: mid, report: { truck: 'Y2' } });
  eq('sent back: open to him again', [r.status, r.json.report.truck], [200, 'Y2']);
  DB[T.mva][mid].fields.fldelaGXvgjkSNxpH = 'With claims';
  session = S('Admin', 'Admin', 'Troy Johnston');
  session = S('Employee', 'Supervisor', 'Derek Melanson');
  r = await call('POST', { mva: mid, action: 'photo', kind: 'licence', vehicle: 2, filename: 'z.jpg', data: 'eA==' });
  eq('the verifier cannot add a vehicle 2 photo', r.status, 409);
  session = S('Admin', 'Admin', 'Troy Johnston');
  r = await call('POST', { mva: mid, report: { truck: 'Y' } });
  eq('…a supervisor can still correct it', [r.status, r.json.report.truck], [200, 'Y']);

  console.log(failures.map(f => '   FAIL  ' + f).join('\n'));
  console.log(`\ntest-accident: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('HARNESS', e.stack); process.exit(1); });
