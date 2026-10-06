/*
 * api/accident.js — the Accident Report and Proof of Repairs for an MVA.
 * ---------------------------------------------------------------------------
 * Troy, 2026-10-06: the patroller sees each MVA through to filing with the
 * insurance company (patrol/mvas.html). The Accident Report is the first item of
 * that folder; the Proof of Repairs fills "Photos of the completed repairs".
 * Both live on ONE Accident Reports row per MVA (Report No. = <MVA No.>-AR),
 * linked to the MVA — the shape the table was built in (road-patrol-mva-claims).
 *
 * The form follows the DeviceMagic "Accident Report" export field for field.
 * Injuries / Fatality are Yes / No / Unknown ("unknown in case they do not attend
 * the mva or the person leaves the scene alive") in the new select fields; the old
 * checkboxes are left alone. Items Used by MRDC is the billable pick-list; the free
 * text Items Used stays for anything else. The spill email is not built (Troy: skip).
 *
 *   GET  ?mva=rec…                          the MVA + its report (or null) + choices
 *   POST {mva, report:{…}}                  save (creates the draft on first save)
 *   POST {mva, report:{…}, submit:true}     submit: required fields checked, folder
 *                                           item "Accident Report" ticked
 *   POST {mva, action:'photo', kind, filename, contentType, data}   upload
 *   POST {mva, action:'photoRemove', kind, fileId}
 *   POST {mva, repairs:{date, notes}, repairsDone:true}   proof of repairs; ticks
 *                                           "Photos of the completed repairs"
 * Ownership: the MVA's patroller / submitter, or a supervisor (mva.js ownsMva).
 * Anything else is 404. Once the MVA is filed with insurance it is read-only to
 * the patroller (409), as the folder is.
 */
const L = require('./_lib');
const { requireCaller } = require('./_auth');
const M = require('./mva').lib;
const { arr, sel, airtable } = L;

const T_AR = process.env.MVA_AR_TABLE || 'tblShwnpWGogKaZxG';
const A = {
  reportNo: 'fldK8gqs6PfZAXNs9', startedAt: 'fldqsmXUkmNSqmlpH', startedBy: 'fldSvWTmRupVXfn6H', trigger: 'fldlNYDv5nAT6dAo0',
  truck: 'fld0Ehu0B9iUAuktz', arrived: 'fldQyKBFIpkFzAiiP', left: 'fld8jizpsetNlXvY6',
  tcByMrdc: 'fldbB8xl51lh1b2BF', tcEmployee: 'fldIGwoRmBlonTyFU', tcUnit: 'fldtD9Mu4TkwaligD',
  tcCalled: 'fld3Klt1G5flvGUNg', tcArrived: 'fldybzk4jnKCu169C', tcLeft: 'fld6FCWVHL0EpXW7d',
  tcMoreText: 'fld8y4jZC70fl2nTF', tcMoreNeeded: 'fldrjl9tzvUkJHX61',
  roadCond: 'fldkInCPQxKuqEkIh', weather: 'fldGz0xuDoHUGZN8n', damages: 'fldxgA24OZTG4QRSa',
  itemsText: 'fldDWhwKmn6sew6sH', items: 'fldVkA60qvqGoK9Zk',
  driver: 'fldTskwroWMBDCjZq', driverIsOwner: 'fldD9VbHyw04cUmgH', owner: 'fldqH8sRqUBMt8fdS', trucking: 'fldwyd11uvJYY06hM',
  licence: 'fld0W71EAx0BoqzGz', vehicle: 'fldZg4C3j0Ti6TkOT', plate: 'fld4cceVBAhLbaW9t',
  insurer: 'flduMRNGlarwbFjnT', policy: 'fld62DuTiuk1VsfJo',
  licencePhoto: 'fld3jQnLxu5n5ggO2', platePhoto: 'fld6VmNkhtBnI9H1K', insurancePhoto: 'fldgtdy42gUHjO4We', accidentPhotos: 'fldZpLjNw1PIiS6Cj',
  dmtOpened: 'fldwNrqoRF9MMcNcE', dmtWo: 'fldYCrKMg0Jc3HIR5',
  repairsDone: 'fldlv5QDWpmfdfuNm', repairDate: 'fldJjoWcXy7ipWEXc', repairNotes: 'fldPye5hBdt7PPaqE', repairPhotos: 'fldmEpRePHQOxRBkv',
  status: 'fldRa0KV1HJzLMOjH', submittedBy: 'fldZttKVyL4byx5aF', submittedAt: 'fld0MpJ9auHkzQfyx', mva: 'fldD01RPTQaqHh5aT',
  division: 'fldS51U7n89nvnC3z', patroller: 'fldAIEl5C8asyAZzp', hitRun: 'fldfexI8q0B3OZZwW', hitRunDetails: 'fld31wSAXkPUroEzk',
  timeOfAccident: 'fldVOF5IkMZU132Af', route: 'fldlnthwLcdTATYaF', km: 'fldMlnaMVstNYIsN0', direction: 'fldJSY1h0VeUp5akf',
  ramp: 'fldq9C583EV8xwy1Y', vehicles: 'fldeIMx9Fv7l2YV5H', ambulance: 'fldevBhn2dpF7hXHa', police: 'fldrt6bbZHAB2sLAF',
  officer: 'fldNHYucsM2iU6YSG', policeFile: 'fld55lFenwTSFhmML', towing: 'fldeQBIz0Bpj18og9',
  spill: 'fldwz2MySSdbCLyb5', fire: 'flda1eMrxZNUVoeWN', doeContacted: 'fldgjigRvD4JRm0c0',
  doeDetails: 'fldzlgK3DQtsVmWlu', fireDetails: 'fldXVTOjjwkx8ASa1',
  injuries3: 'fldWdeQqgXx7ycBmo', fatality3: 'fld0XMlrjJ5atFqoH',
};
const CHOICES = {
  divisions: ['Eastern', 'Western'], routes: ['Route 2', 'Route 7', 'Other'], directions: ['EB', 'WB', 'NB', 'SB'],
  ramps: ['ON Ramp', 'OFF Ramp'], ynu: ['Yes', 'No', 'Unknown'],
  items: ['None', 'Signs', 'First Aid Kit', 'Spill Kit', 'Fire Extinguisher'],
};
// Free-text fields: key → field (and a length cap).
const TEXT = ['truck', 'tcEmployee', 'tcUnit', 'tcMoreText', 'roadCond', 'weather', 'damages', 'itemsText', 'driver', 'owner',
  'trucking', 'licence', 'vehicle', 'plate', 'insurer', 'policy', 'dmtWo', 'patroller', 'hitRunDetails', 'officer', 'policeFile',
  'towing', 'doeDetails', 'fireDetails'];
const BOOL = ['tcByMrdc', 'tcMoreNeeded', 'driverIsOwner', 'dmtOpened', 'hitRun', 'ambulance', 'police', 'spill', 'fire', 'doeContacted'];
const TIMES = ['timeOfAccident', 'arrived', 'left', 'tcCalled', 'tcArrived', 'tcLeft'];
const PHOTO = { licence: 'licencePhoto', plate: 'platePhoto', insurance: 'insurancePhoto', accident: 'accidentPhotos', repair: 'repairPhotos' };
// Submit needs these (the DeviceMagic form's required set, plus the two Yes/No/Unknown).
const REQUIRED = [['patroller', 'Patroller'], ['division', 'Division'], ['timeOfAccident', 'Time of accident'], ['route', 'Route'],
  ['km', 'KM location'], ['direction', 'Direction'], ['vehicles', 'Number of vehicles'], ['injuries', 'Injuries'],
  ['fatality', 'Fatality'], ['roadCond', 'Road conditions'], ['weather', 'Weather conditions'], ['damages', 'Description of damages']];

const isoOk = v => typeof v === 'string' && !isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T/.test(v);
function toFields(r) {
  const f = {};
  for (const k of TEXT) if (r[k] !== undefined) f[A[k]] = String(r[k] == null ? '' : r[k]).slice(0, 5000);
  for (const k of BOOL) if (r[k] !== undefined) f[A[k]] = !!r[k];
  for (const k of TIMES) if (r[k] !== undefined) f[A[k]] = r[k] && isoOk(r[k]) ? r[k] : null;
  const pick = (list, v) => (v === '' || v == null ? null : list.includes(v) ? v : undefined);
  const one = (k, field, list) => { if (r[k] !== undefined) { const v = pick(list, r[k]); if (v !== undefined) f[field] = v; } };
  one('division', A.division, CHOICES.divisions); one('route', A.route, CHOICES.routes); one('direction', A.direction, CHOICES.directions);
  one('injuries', A.injuries3, CHOICES.ynu); one('fatality', A.fatality3, CHOICES.ynu);
  if (r.ramp !== undefined) f[A.ramp] = CHOICES.ramps.includes(r.ramp) ? r.ramp : '';
  if (r.items !== undefined) f[A.items] = arr(r.items).filter(v => CHOICES.items.includes(v));
  if (r.km !== undefined) { const n = Number(r.km); f[A.km] = r.km === '' || r.km == null || isNaN(n) ? null : n; }
  if (r.vehicles !== undefined) { const n = parseInt(r.vehicles, 10); f[A.vehicles] = r.vehicles === '' || r.vehicles == null || isNaN(n) ? null : n; }
  return f;
}
function shapeAR(rec) {
  if (!rec) return null;
  const f = rec.fields || {}, out = { id: rec.id, reportNo: f[A.reportNo] || '' };
  for (const k of TEXT) out[k] = f[A[k]] || '';
  for (const k of BOOL) out[k] = !!f[A[k]];
  for (const k of TIMES) out[k] = f[A[k]] || '';
  Object.assign(out, { division: sel(f[A.division]), route: sel(f[A.route]), direction: sel(f[A.direction]), ramp: f[A.ramp] || '',
    injuries: sel(f[A.injuries3]), fatality: sel(f[A.fatality3]), items: arr(f[A.items]).map(sel),
    km: f[A.km] != null ? f[A.km] : '', vehicles: f[A.vehicles] != null ? f[A.vehicles] : '',
    status: sel(f[A.status]) || 'Draft', submittedBy: f[A.submittedBy] || '', submittedAt: f[A.submittedAt] || '',
    startedBy: f[A.startedBy] || '', startedAt: f[A.startedAt] || '',
    repairsDone: !!f[A.repairsDone], repairDate: f[A.repairDate] || '', repairNotes: f[A.repairNotes] || '' });
  out.photos = {};
  for (const [kind, key] of Object.entries(PHOTO)) out.photos[kind] = arr(f[A[key]]).map(a => ({ id: a.id, url: a.url, filename: a.filename,
    thumb: a.thumbnails?.large?.url || a.thumbnails?.small?.url || '' }));
  return out;
}
const reportNo = mva => `${mva.mvaNo}-AR`;
async function findReport(mva) {
  const qs = new URLSearchParams();
  qs.set('returnFieldsByFieldId', 'true'); qs.set('maxRecords', '1');
  qs.set('filterByFormula', `{Report No.}='${reportNo(mva).replace(/'/g, "\\'")}'`);
  const j = await airtable(`${M.BASE}/${T_AR}?${qs}`);
  return (j.records || [])[0] || null;
}
async function ensureReport(mva, caller) {
  const hit = await findReport(mva);
  if (hit) return hit;
  const trig = [mva.damages && 'Damages to facility', mva.fatality && 'Fatality', mva.extensiveTC && 'Extensive traffic control'].filter(Boolean);
  return airtable(`${M.BASE}/${T_AR}`, { method: 'POST', body: JSON.stringify({ returnFieldsByFieldId: true, fields: {
    [A.reportNo]: reportNo(mva), [A.mva]: [mva.id], [A.status]: 'Draft', [A.trigger]: trig,
    [A.startedBy]: caller.name || '', [A.startedAt]: new Date().toISOString() } }) });
}
async function patch(id, fields) {
  return airtable(`${M.BASE}/${T_AR}/${id}`, { method: 'PATCH', body: JSON.stringify({ returnFieldsByFieldId: true, fields }) });
}
// Tick a folder item done (MVA File Folder), as the folder page does.
function tick(caller, now) {
  const FF = M.FF, who = caller.name || '';
  return { [FF.done]: true, [FF.doneBy]: who, [FF.doneAt]: now, [FF.updatedBy]: who, [FF.updatedAt]: now };
}
function missingFor(r) { return REQUIRED.filter(([k]) => r[k] === '' || r[k] == null).map(([, label]) => label); }

module.exports = async function handler(req, res) {
  if (L.cors(req, res)) return;
  if (!L.PAT) return res.status(500).json({ error: 'Server not configured (AIRTABLE_PAT missing)' });
  const caller = await requireCaller(req, res);
  if (!caller) return;
  try {
    if (req.method === 'GET') {
      const mva = await M.loadOwned(req.query?.mva, caller);
      if (!mva) return res.status(404).json(M.NOT_FOUND);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ mva, report: shapeAR(await findReport(mva)), choices: CHOICES, admin: !!caller.isAdmin });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = L.parseBody(req);
    const mva = await M.loadOwned(body.mva, caller);
    if (!mva) return res.status(404).json(M.NOT_FOUND);
    if (mva.filedDate && !caller.isAdmin)
      return res.status(409).json({ error: 'This MVA has been filed with insurance — the accident report is closed. Ask a supervisor if something needs changing.' });
    const now = new Date().toISOString();
    let rec = await ensureReport(mva, caller);
    let note = '';

    if (body.action === 'photo') {
      const key = PHOTO[body.kind];
      if (!key) return res.status(400).json({ error: 'Unknown photo' });
      if (!body.data) return res.status(400).json({ error: 'data (base64) is required' });
      await L.uploadAttachment({ base: M.BASE, recordId: rec.id, fieldId: A[key], filename: body.filename, contentType: body.contentType, data: body.data });
      rec = await airtable(`${M.BASE}/${T_AR}/${rec.id}?returnFieldsByFieldId=true`);
    } else if (body.action === 'photoRemove') {
      const key = PHOTO[body.kind];
      if (!key) return res.status(400).json({ error: 'Unknown photo' });
      const keep = arr((rec.fields || {})[A[key]]).filter(a => a.id !== body.fileId).map(a => ({ id: a.id }));
      rec = await patch(rec.id, { [A[key]]: keep });
    } else {
      const f = body.report ? toFields(body.report) : {};
      if (body.repairs) {
        if (body.repairs.date !== undefined) f[A.repairDate] = /^\d{4}-\d{2}-\d{2}$/.test(String(body.repairs.date)) ? body.repairs.date : null;
        if (body.repairs.notes !== undefined) f[A.repairNotes] = String(body.repairs.notes || '').slice(0, 5000);
      }
      if (Object.keys(f).length) rec = await patch(rec.id, f);
      const cur = shapeAR(rec);
      if (body.submit) {
        const missing = missingFor(cur);
        if (missing.length) return res.status(400).json({ error: 'Still needed: ' + missing.join(', '), missing, report: cur });
        if (cur.status === 'Draft') rec = await patch(rec.id, { [A.status]: 'Submitted', [A.submittedBy]: caller.name || '', [A.submittedAt]: now });
        await M.upsertItem(mva, 'Accident Report', tick(caller, now));
        note = 'submitted';
      }
      if (body.repairsDone) {
        const missing = [!cur.repairDate && 'Date of repairs', !cur.photos.repair.length && 'At least one repair photo'].filter(Boolean);
        if (missing.length) return res.status(400).json({ error: 'Still needed: ' + missing.join(', '), missing, report: cur });
        rec = await patch(rec.id, { [A.repairsDone]: true });
        await M.upsertItem(mva, 'Photos of the completed repairs', tick(caller, now));
        note = 'repairs';
      }
    }
    return res.status(200).json({ mva, report: shapeAR(rec), saved: note || 'saved' });
  } catch (e) {
    console.error('accident error:', e);
    return res.status(e.status && e.status < 500 ? e.status : 500).json({ error: e.message || 'Server error' });
  }
};
module.exports.lib = { A, CHOICES, REQUIRED, toFields, shapeAR, missingFor };
