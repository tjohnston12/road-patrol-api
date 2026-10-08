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
 * More than one vehicle (Troy, 2026-10-07: "when there is more than one vehicle involved,
 * there will need to be two sets of drivers and vehicle info gathered"): vehicle 1 stays on
 * the Accident Reports row; vehicles 2, 3… are rows in Accident Vehicles (Vehicle Ref =
 * <Report No.>-V<n>), one per vehicle, with the same driver / vehicle / insurance fields and
 * photos. "# of vehicles involved" decides how many sets submit asks for.
 *   report.extraVehicles: [{n, driver, …}]   saved with the report (n = 2…10)
 *   photo / photoRemove take vehicle: n      (absent or 1 = the report row)
 * Official weather (Troy, 2026-10-07: "Can we link a weather app to record official conditions
 * at the time?"): POST {mva, action:'weather'} looks up the Environment and Climate Change Canada
 * station observation nearest the scene (the MVA's GPS, else the division's airport) closest to
 * the time of the accident, from api.weather.gc.ca (swob-realtime — NAV CANADA airports and MSC
 * stations along the corridor), and saves a plain summary + the station, time and a link to the
 * original record. That service keeps about 30 days, so it is captured when the report is
 * worked on, and again automatically on submit if it was never fetched.
 * Ownership: the MVA's patroller / submitter, or a supervisor (mva.js ownsMva).
 * The file's reviewers (verifier, approver, claims manager) can read it. Anyone else
 * is 404. Only the patroller (while Open / Sent back) or an admin may change it (409).
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
  officialWeather: 'fldMXyqLpqpBMpAjR', officialWeatherStation: 'fldOwrXAOQ3iqRVhh', officialWeatherAt: 'fldo6kZHO0YUtsyFV', officialWeatherUrl: 'fldObWVGNF4TdevJj',
  hasTrailer: 'fldnwBKWP05K43yPx', trailerPlatePhoto: 'fldWb06wd1RE8uuiq', trailerPlate: 'fldj44y9MXHrp42Nz',
};
// Vehicles 2…10 (Accident Vehicles). Vehicle 1 is the report row (A above).
const T_VEH = process.env.MVA_VEH_TABLE || 'tblpMfPIXMJhFmuuw';
const V = {
  ref: 'fldwfUp29kQs8NQI7', report: 'fld7fXDhTxP7HC637', n: 'fldCOloDspNrByuT7',
  driver: 'fldrsCPZRY84m6vr7', driverIsOwner: 'fldE4n4paHReCNHk0', owner: 'fldtGGTTroYRmTchK', trucking: 'fld4iBnimIgzmM277',
  licence: 'fldDsuynBPZDXOw9l', vehicle: 'fld1sdbF1wNqCtSjn', plate: 'fldzShG6OD5pz0lZv', hasTrailer: 'fldSrbIaByRSsdc6x',
  trailerPlate: 'fldpyjn6ruBStlGaF', insurer: 'fldGXaDmNHwrRhosf', policy: 'fldVRqmwsvcPfZmO7',
  licencePhoto: 'fld8jYrCXrGqsSm9N', platePhoto: 'fldl5T1V1XHzV5USf', trailerPlatePhoto: 'fldQWeXpFVddoF5FS', insurancePhoto: 'fld3RVNUJQDkjFxpi',
};
const V_TEXT = ['driver', 'owner', 'trucking', 'licence', 'vehicle', 'plate', 'trailerPlate', 'insurer', 'policy'];
const V_BOOL = ['driverIsOwner', 'hasTrailer'];
const V_PHOTO = { licence: 'licencePhoto', plate: 'platePhoto', trailer: 'trailerPlatePhoto', insurance: 'insurancePhoto' };
const MAX_VEHICLES = 10;
const CHOICES = {
  divisions: ['Eastern', 'Western'], routes: ['Route 1', 'Route 2', 'Route 7', 'Route 8', 'Other'], directions: ['EB', 'WB', 'NB', 'SB'],   // all routes (Troy, 2026-10-08)
  ramps: ['ON Ramp', 'OFF Ramp'], ynu: ['Yes', 'No', 'Unknown'],
  items: ['None', 'Signs', 'First Aid Kit', 'Spill Kit', 'Fire Extinguisher'],
};
// Free-text fields: key → field (and a length cap).
const TEXT = ['truck', 'tcEmployee', 'tcUnit', 'tcMoreText', 'roadCond', 'weather', 'damages', 'itemsText', 'driver', 'owner',
  'trucking', 'licence', 'vehicle', 'plate', 'insurer', 'policy', 'dmtWo', 'patroller', 'hitRunDetails', 'officer', 'policeFile',
  'towing', 'doeDetails', 'fireDetails', 'trailerPlate'];
const BOOL = ['hasTrailer', 'tcByMrdc', 'tcMoreNeeded', 'driverIsOwner', 'dmtOpened', 'hitRun', 'ambulance', 'police', 'spill', 'fire', 'doeContacted'];
const TIMES = ['timeOfAccident', 'arrived', 'left', 'tcCalled', 'tcArrived', 'tcLeft'];
const PHOTO = { licence: 'licencePhoto', plate: 'platePhoto', trailer: 'trailerPlatePhoto', insurance: 'insurancePhoto', accident: 'accidentPhotos', repair: 'repairPhotos' };
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
    officialWeather: f[A.officialWeather] || '', officialWeatherStation: f[A.officialWeatherStation] || '',
    officialWeatherAt: f[A.officialWeatherAt] || '', officialWeatherUrl: f[A.officialWeatherUrl] || '',
    repairsDone: !!f[A.repairsDone], repairDate: f[A.repairDate] || '', repairNotes: f[A.repairNotes] || '' });
  out.photos = {};
  for (const [kind, key] of Object.entries(PHOTO)) out.photos[kind] = arr(f[A[key]]).map(a => ({ id: a.id, url: a.url, filename: a.filename,
    thumb: a.thumbnails?.large?.url || a.thumbnails?.small?.url || '' }));
  return out;
}
const reportNo = mva => `${mva.mvaNo}-AR`;
const vehRef = (rec, n) => `${(rec.fields || {})[A.reportNo]}-V${n}`;
const vehN = v => { const n = parseInt(v, 10); return n >= 2 && n <= MAX_VEHICLES ? n : 0; };
function shapeVeh(rec) {
  const f = rec.fields || {}, out = { id: rec.id, n: f[V.n] || 0 };
  for (const k of V_TEXT) out[k] = f[V[k]] || '';
  for (const k of V_BOOL) out[k] = !!f[V[k]];
  out.photos = {};
  for (const [kind, key] of Object.entries(V_PHOTO)) out.photos[kind] = arr(f[V[key]]).map(a => ({ id: a.id, url: a.url, filename: a.filename,
    thumb: a.thumbnails?.large?.url || a.thumbnails?.small?.url || '' }));
  return out;
}
async function vehicleRows(rec) {
  if (!rec) return [];
  const qs = new URLSearchParams(), pre = `${(rec.fields || {})[A.reportNo]}-V`;
  qs.set('returnFieldsByFieldId', 'true');
  qs.set('filterByFormula', `FIND('${pre.replace(/'/g, "\\'")}',{Vehicle Ref})=1`);
  const j = await airtable(`${M.BASE}/${T_VEH}?${qs}`);
  return (j.records || []).filter(r => vehN((r.fields || {})[V.n])).sort((a, b) => a.fields[V.n] - b.fields[V.n]);
}
async function ensureVehicle(rec, rows, n) {
  const hit = rows.find(r => r.fields[V.n] === n);
  if (hit) return hit;
  const made = await airtable(`${M.BASE}/${T_VEH}`, { method: 'POST', body: JSON.stringify({ returnFieldsByFieldId: true, fields: {
    [V.ref]: vehRef(rec, n), [V.report]: [rec.id], [V.n]: n } }) });
  rows.push(made);
  return made;
}
// Save the extra vehicles sent with the report. A vehicle with nothing filled in is not
// created (autosave sends the empty set as soon as the count goes up); an unchanged one is
// not written.
async function saveVehicles(rec, rows, list) {
  for (const v of arr(list)) {
    const n = vehN(v && v.n);
    if (!n) continue;
    const f = {};
    for (const k of V_TEXT) if (v[k] !== undefined) f[V[k]] = String(v[k] == null ? '' : v[k]).slice(0, 5000);
    for (const k of V_BOOL) if (v[k] !== undefined) f[V[k]] = !!v[k];
    const hit = rows.find(r => r.fields[V.n] === n);
    if (!hit && !Object.values(f).some(x => x)) continue;
    const row = hit || await ensureVehicle(rec, rows, n);
    const cur = row.fields || {};
    const diff = Object.fromEntries(Object.entries(f).filter(([k, x]) => (cur[k] || (typeof x === 'boolean' ? false : '')) !== x));
    if (!Object.keys(diff).length) continue;
    const upd = await airtable(`${M.BASE}/${T_VEH}/${row.id}`, { method: 'PATCH', body: JSON.stringify({ returnFieldsByFieldId: true, fields: diff }) });
    rows[rows.indexOf(row)] = upd;
  }
}
function withVehicles(rep, rows) { if (rep) rep.extraVehicles = rows.map(shapeVeh); return rep; }
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
  // typecast: Route 1 and Route 8 join the Accident Reports Route select on first use (2026-10-08).
  return airtable(`${M.BASE}/${T_AR}/${id}`, { method: 'PATCH', body: JSON.stringify({ returnFieldsByFieldId: true, typecast: true, fields }) });
}
// Tick a folder item done (MVA File Folder), as the folder page does.
function tick(caller, now) {
  const FF = M.FF, who = caller.name || '';
  return { [FF.done]: true, [FF.doneBy]: who, [FF.doneAt]: now, [FF.updatedBy]: who, [FF.updatedAt]: now };
}
// The photos the report needs (Troy, 2026-10-06: "to save errors on the patrollers part,
// we have been getting them to get a photo of the license plate (both truck and trailer if
// necessary), the drivers license, the insurance card. This in in addition to photos of
// the damages.") A photo is the record — the typed numbers are optional. A hit & run has
// no driver or vehicle to photograph, so only the damage photos are needed then.
/* ---- Official weather: Environment and Climate Change Canada ---------------------------- */
const WX_API = process.env.WX_API || 'https://api.weather.gc.ca/collections/swob-realtime/items';
const WX_BBOX = '-67.3,45.3,-64.0,46.6';           // the Fredericton–Moncton corridor and its stations
const WX_KEEP_DAYS = 29;                            // swob-realtime keeps about 30 days
// No GPS on the MVA: the division's airport stands in for the scene.
const DIV_POINT = { Western: [45.869, -66.537], Eastern: [46.112, -64.679] };
function parseGps(g) {
  const m = String(g || '').match(/(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const lat = +m[1], lon = +m[2];
  return lat > 40 && lat < 50 && lon > -70 && lon < -60 ? [lat, lon] : null;
}
function km([a, b], [c, d]) {
  const r = x => x * Math.PI / 180, dLat = r(c - a), dLon = r(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const first = (p, keys) => { for (const k of keys) if (p[k] != null && p[k] !== '' && p[k] !== 'MSNG') return p[k]; return null; };
const wxLocal = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Moncton', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }).format(new Date(iso)).replace(',', '');
function wxSummary(p, distKm, mins, scene) {
  const temp = first(p, ['air_temp']), dew = first(p, ['dwpt_temp']), hum = first(p, ['rel_hum']);
  const spd = first(p, ['avg_wnd_spd_10m_pst2mts', 'avg_wnd_spd_10m_pst10mts', 'avg_wnd_spd_10m_pst1hr']);
  const dir = first(p, ['avg_wnd_dir_10m_pst2mts', 'avg_wnd_dir_10m_pst10mts', 'avg_wnd_dir_10m_pst1hr']);
  const gust = first(p, ['max_wnd_spd_10m_pst1hr']);
  const vis = first(p, ['vis', 'avg_vis_pst10mts', 'avg_vis_pst1hr']);
  const pcpn = first(p, ['pcpn_amt_pst1hr', 'rnfl_amt_pst1hr']);
  const snow = first(p, ['snw_dpth', 'avg_snw_dpth_pst5mts']);
  const when = mins === 0 ? 'at the time of the accident' : `${Math.abs(mins)} min ${mins < 0 ? 'before' : 'after'} the accident`;
  const lines = [
    `Environment and Climate Change Canada observation — ${p['stn_nam-value'] || 'station'}${p['data_pvdr-value'] ? ' (' + p['data_pvdr-value'] + ')' : ''}`,
    `Observed ${wxLocal(p.obs_date_tm || p['date_tm-value'])} (${when}), ${Math.round(distKm)} km from ${scene}`,
  ];
  if (temp != null) lines.push(`Temperature ${temp} °C` + (dew != null ? `, dew point ${dew} °C` : '') + (hum != null ? `, humidity ${hum}%` : ''));
  if (spd != null) lines.push(`Wind ${dir != null && +spd > 0 ? 'from ' + COMPASS[Math.round(+dir / 22.5) % 16] + ' ' : ''}${Math.round(+spd)} km/h` + (gust != null && +gust > +spd ? `, gusting ${Math.round(+gust)} km/h` : ''));
  if (vis != null) lines.push(`Visibility ${Math.round(+vis * 10) / 10} km`);
  if (pcpn != null) lines.push(`Precipitation in the past hour ${pcpn} mm`);
  if (snow != null && +snow > 0) lines.push(`Snow on the ground ${snow} cm`);
  if (p['data_attrib_not-value']) lines.push(p['data_attrib_not-value']);
  return lines.join('\n');
}
// → { text, station, at, url } or throws a 4xx with a plain reason.
async function officialWeather(whenIso, mva, division) {
  const fail = (status, msg) => Object.assign(new Error(msg), { status });
  const t = Date.parse(whenIso || '');
  if (isNaN(t)) throw fail(400, 'Enter the time of the accident first.');
  if (t > Date.now() + 10 * 60000) throw fail(400, 'The time of the accident is in the future.');
  if (Date.now() - t > WX_KEEP_DAYS * 864e5) throw fail(404, 'Environment Canada keeps the live station reports for about 30 days and this accident is older — use the historical data at climate.weather.gc.ca.');
  const gps = parseGps(mva && mva.gps), here = gps || DIV_POINT[division] || DIV_POINT.Western;
  const scene = gps ? 'the scene (GPS)' : `the scene (no GPS — the ${division || 'Western'} division's airport was used)`;
  const qs = new URLSearchParams({ f: 'json', limit: '1000', bbox: WX_BBOX,
    datetime: `${new Date(t - 75 * 60000).toISOString().replace(/\.\d+Z$/, 'Z')}/${new Date(t + 20 * 60000).toISOString().replace(/\.\d+Z$/, 'Z')}` });
  let j;
  try {
    const r = await fetch(`${WX_API}?${qs}`, { headers: { Accept: 'application/geo+json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    j = await r.json();
  } catch (e) { throw fail(502, 'Environment Canada did not answer (' + e.message + ') — try again in a minute.'); }
  const obs = (j.features || []).filter(f => f && f.properties && !/minute/.test(f.id || '') && first(f.properties, ['air_temp']) != null
    && Array.isArray(f.geometry && f.geometry.coordinates))
    .map(f => { const p = f.properties, at = Date.parse(p.obs_date_tm || p['date_tm-value']);
      return { f, p, at, dist: km(here, [f.geometry.coordinates[1], f.geometry.coordinates[0]]), dt: Math.abs(at - t), vis: first(p, ['vis', 'avg_vis_pst10mts']) != null }; })
    .filter(o => !isNaN(o.at));
  if (!obs.length) throw fail(404, 'No Environment Canada station report was found within an hour of the time of the accident.');
  const nearest = Math.min(...obs.map(o => o.dist));
  // The nearest station (within 1 km counts as the same site); of its reports, the closest in time, a full one first.
  const pick = obs.filter(o => o.dist - nearest < 1).sort((a, b) => a.dt - b.dt || (b.vis - a.vis))[0];
  const mins = Math.round((pick.at - t) / 60000);
  return { text: wxSummary(pick.p, pick.dist, mins, scene), station: pick.p['stn_nam-value'] || '', at: new Date(pick.at).toISOString(), url: pick.p.url || '' };
}
const wxFields = w => ({ [A.officialWeather]: w.text, [A.officialWeatherStation]: w.station, [A.officialWeatherAt]: w.at, [A.officialWeatherUrl]: w.url || null });

// One set per vehicle involved: "# of vehicles involved" (at least 1, at most 10).
function vehicleCount(r) { const n = parseInt(r.vehicles, 10); return Math.min(MAX_VEHICLES, Math.max(1, isNaN(n) ? 1 : n)); }
function photosMissing(r, mva) {
  const p = r.photos || {}, out = [];
  if (!(p.accident || []).length && !((mva && mva.photos) || []).length) out.push('Photos of the accident and damages');
  if (r.hitRun) return out;
  const count = vehicleCount(r), extra = arr(r.extraVehicles);
  for (let i = 1; i <= count; i++) {
    const v = i === 1 ? r : (extra.find(x => x.n === i) || { photos: {} });
    const vp = v.photos || {}, n = k => (vp[k] || []).length, pre = count > 1 ? `Vehicle ${i}: ` : '';
    if (!n('licence')) out.push(pre + "Photo of the driver's licence");
    if (!n('plate')) out.push(pre + 'Photo of the licence plate');
    if (v.hasTrailer && !n('trailer')) out.push(pre + "Photo of the trailer's licence plate");
    if (!n('insurance')) out.push(pre + 'Photo of the insurance card');
  }
  return out;
}
/* ---- The patrol truck (Troy, 2026-10-08: "does the patrol truck have a drop down list from fleet
   or can it fill from the patrol report that has been started" — both). The fleet list is the
   daily report's (10-series pickups, from patrol.js); the truck comes from the MVA patroller's
   own patrol report for that shift: the one whose shift covers the time of the MVA, else one
   from that day, else the day before (a night shift). Never fatal — the box stays typeable. */
const P = require('./patrol').__test;
const PR = { base: process.env.AIRTABLE_BASE || 'app2m7rkP51kLLpbe', table: process.env.PATROL_TABLE || 'tblosu2dzKTwhuHnf' };
function dayBefore(d) { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); }
function pickReport(rows, mva) {
  const at = mva.occurredAt ? new Date(mva.occurredAt).getTime() : NaN, day = mva.date || '';
  const withVeh = rows.filter(r => r.vehicle);
  const covers = withVeh.filter(r => r.start && !isNaN(at) && new Date(r.start).getTime() <= at && (!r.end || new Date(r.end).getTime() >= at));
  if (covers.length) return covers.sort((a, b) => b.start.localeCompare(a.start))[0];
  const same = withVeh.filter(r => r.date === day).sort((a, b) => (b.start || '').localeCompare(a.start || ''));
  if (same.length) return same[0];
  const prev = withVeh.filter(r => r.date === dayBefore(day)).sort((a, b) => (b.start || '').localeCompare(a.start || ''));
  return prev[0] || null;
}
async function truckFromReport(mva) {
  try {
    const name = String(mva.patroller || '').trim().toLowerCase();
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(mva.date || '')) return null;
    const qs = new URLSearchParams();
    qs.set('returnFieldsByFieldId', 'true'); qs.set('pageSize', '20');
    for (const k of ['reportId', 'shiftDate', 'patroller', 'vehicle', 'shiftStart', 'shiftEnd']) qs.append('fields[]', P.F[k]);
    const esc = v => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    qs.set('filterByFormula', `AND(LOWER(TRIM({Patroller}))='${esc(name)}', OR(DATETIME_FORMAT({Shift Date},'YYYY-MM-DD')='${mva.date}', DATETIME_FORMAT({Shift Date},'YYYY-MM-DD')='${dayBefore(mva.date)}'))`);
    const j = await airtable(`${PR.base}/${PR.table}?${qs}`);
    const rows = (j.records || []).map(r => { const f = r.fields || {}; return { reportId: f[P.F.reportId] || '', date: f[P.F.shiftDate] || '',
      patroller: String(f[P.F.patroller] || ''), vehicle: String(f[P.F.vehicle] || '').trim(), start: f[P.F.shiftStart] || '', end: f[P.F.shiftEnd] || '' }; })
      .filter(r => r.patroller.trim().toLowerCase() === name);       // re-checked here: the formula is not trusted alone
    const hit = pickReport(rows, mva);
    return hit ? { vehicle: hit.vehicle, reportId: hit.reportId, shiftDate: hit.date } : null;
  } catch (_) { return null; }
}
async function truckChoices() {
  const fleet = await P.getFleet().catch(() => []);
  return fleet.map(u => ({ unit: u.unit, patrol: /patrol/i.test(u.designation || ''), depot: u.depot || '',
    description: [u.make && u.model && u.model.toLowerCase().startsWith(u.make.toLowerCase()) ? u.model : [u.make, u.model].filter(Boolean).join(' '), u.designation].filter(Boolean).join(' · ') }));
}

function missingFor(r, mva) { return REQUIRED.filter(([k]) => r[k] === '' || r[k] == null).map(([, label]) => label).concat(photosMissing(r, mva)); }

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
      const found = await findReport(mva);
      const [fleet, fromReport] = await Promise.all([truckChoices(), truckFromReport(mva)]);
      return res.status(200).json({ mva, report: withVehicles(shapeAR(found), await vehicleRows(found)), choices: CHOICES, admin: !!caller.isAdmin, canEdit: M.canEdit(mva),
        truck: { fleet, fromReport } });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = L.parseBody(req);
    const mva = await M.loadOwned(body.mva, caller);
    if (!mva) return res.status(404).json(M.NOT_FOUND);
    // Editable while the file is the patroller's (Open / Sent back), or by an admin.
    // Once submitted it goes up the route (mva.js step) and is read-only to everyone
    // else — a reviewer sends it back with a note instead of changing it.
    if (!M.canEdit(mva))
      return res.status(409).json({ error: mva.access && mva.access.own ? 'The accident file has been submitted (' + mva.stage + ') — it can only be changed if it is sent back to you.'
                                                                        : 'Only the patroller fills in the accident report — send the file back with a note if something is missing.' });
    const now = new Date().toISOString();
    let rec = await ensureReport(mva, caller);
    const rows = await vehicleRows(rec);
    let note = '';
    // Which vehicle a photo is for: absent / 1 = the report row, 2…10 = Accident Vehicles.
    const vn = body.vehicle == null || +body.vehicle === 1 ? 1 : vehN(body.vehicle);
    if ((body.action === 'photo' || body.action === 'photoRemove') && !vn) return res.status(400).json({ error: 'Unknown vehicle' });

    if (body.action === 'photo' && vn > 1) {
      const key = V_PHOTO[body.kind];
      if (!key) return res.status(400).json({ error: 'Unknown photo' });
      if (!body.data) return res.status(400).json({ error: 'data (base64) is required' });
      const row = await ensureVehicle(rec, rows, vn);
      await L.uploadAttachment({ base: M.BASE, recordId: row.id, fieldId: V[key], filename: body.filename, contentType: body.contentType, data: body.data });
      rows[rows.indexOf(row)] = await airtable(`${M.BASE}/${T_VEH}/${row.id}?returnFieldsByFieldId=true`);
    } else if (body.action === 'photoRemove' && vn > 1) {
      const key = V_PHOTO[body.kind];
      if (!key) return res.status(400).json({ error: 'Unknown photo' });
      const row = rows.find(r => r.fields[V.n] === vn);
      if (row) {
        const keep = arr(row.fields[V[key]]).filter(a => a.id !== body.fileId).map(a => ({ id: a.id }));
        rows[rows.indexOf(row)] = await airtable(`${M.BASE}/${T_VEH}/${row.id}`, { method: 'PATCH', body: JSON.stringify({ returnFieldsByFieldId: true, fields: { [V[key]]: keep } }) });
      }
    } else if (body.action === 'weather') {
      const cur = shapeAR(rec);
      const w = await officialWeather(cur.timeOfAccident || mva.occurredAt, mva, cur.division || mva.division);
      rec = await patch(rec.id, wxFields(w));
      note = 'weather';
    } else if (body.action === 'photo') {
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
      if (body.report && body.report.extraVehicles !== undefined) await saveVehicles(rec, rows, body.report.extraVehicles);
      const cur = withVehicles(shapeAR(rec), rows);
      if (body.submit) {
        const missing = missingFor(cur, mva);
        if (missing.length) return res.status(400).json({ error: 'Still needed: ' + missing.join(', '), missing, report: cur });
        if (cur.status === 'Draft') rec = await patch(rec.id, { [A.status]: 'Submitted', [A.submittedBy]: caller.name || '', [A.submittedAt]: now });
        // The live station reports only last about 30 days: record them now if nobody did.
        if (!cur.officialWeather) {
          try { rec = await patch(rec.id, wxFields(await officialWeather(cur.timeOfAccident, mva, cur.division))); }
          catch (e) { console.warn('accident: official weather on submit:', e.message); }
        }
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
    return res.status(200).json({ mva, report: withVehicles(shapeAR(rec), rows), saved: note || 'saved' });
  } catch (e) {
    console.error('accident error:', e);
    return res.status(e.status && e.status < 500 ? e.status : 500).json({ error: e.message || 'Server error' });
  }
};
module.exports.lib = { officialWeather, parseGps, A, V, CHOICES, REQUIRED, toFields, shapeAR, missingFor, photosMissing, vehicleCount, pickReport, truckFromReport, truckChoices, dayBefore };
