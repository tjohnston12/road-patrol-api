// api/rwis.js — road-patrol-api (Vercel)
//
// RWIS Temperature Check for the Road Patrol app (www.mrdc-htra.com/patrol/rwis.html). Replaces
// the DeviceMagic "RWIS Temperature Check" form (its Airtable copy: Winter Operations base,
// RWIS Temps). Troy: "RWIS stations are weather stations used by patrollers to determine road and
// air temperatures" … "RWIS is also in the OMM agreement" — OMM 601.2.2(c): weather and pavement
// data are recorded via the RWIS. The check compares the patrol truck's own air and road (infrared)
// readings with the station's, so a station that has drifted is caught before it corrupts the
// winter record. The finding is the GAP, not the numbers.
//
// Troy, 2026-10-13:
//   - flag a station when air or road differs by 2 °C or more;
//   - a flagged check emails the "RWIS Checks" list (fallback: Operations Manager + Area Managers),
//     on the "RWIS check email" switch in Patrol Notifications (Off / Owner test / Everyone);
//     a normal check is only recorded.
// The record is always saved first; an email that fails never loses it.
//
// Station offline (Troy, same day: "if the rwis station is off line or not showing temps, how do
// the patrollers enter an n/a"): each STATION reading can be marked "no reading" (rwisAirNA /
// rwisRoadNA). The truck's readings are still required — they are the evidence for the day. The
// station value and its diff are left blank, `No Station Reading` says which, and the check is
// Flagged: a station that is not reporting needs looking at as much as one that is wrong.
//
// Base MRDC-HTRA - Road Patrol (app2m7rkP51kLLpbe), table RWIS Checks.
//
// GET  /api/rwis?meta=1  -> { stations, threshold, trucks, patrollers, me }
// GET  /api/rwis         -> { stations: [{ station, where, last }], recent }   recent = last 30 days, newest first
// POST /api/rwis {station, truck, ptAir, rwisAir, ptRoad, rwisRoad, comments?, checkedBy?, checkedAt?}
//                        -> { check, email }

const L = require('./_lib');
const C = require('./_conditions');
const { requireCaller } = require('./_auth');
const P = require('./patrol').__test;

const T_RWIS = 'tblfnW5kpD7SkTOqv';
const F = {
  id: 'fldPs2pW6sRUYMK3D', station: 'fld4Jg2Fi6GcAPVs8', checkedAt: 'fldhdlXIflupql2sI', truck: 'fldMIuTkmJJZhiRt8',
  fleet: 'fldrGc8DTEbEXlIBn', ptAir: 'fldHRpGO7PaEzRM8W', rwisAir: 'fld9IqbKs7Upj4i4Z', airDiff: 'fldjz6XaR5krchJ4p',
  ptRoad: 'fldcQy5fD25ABrWRV', rwisRoad: 'fldeeYUCQnPbnpMet', roadDiff: 'fldIrR6JGviiko58u', flagged: 'fld009Dp4eqO265Us',
  comments: 'fld7uv94p8rHKqXMp', checkedBy: 'fldsuhcrPZ74ZOxTZ', enteredBy: 'fldWVbbSfeVTzvw0J',
  emailedTo: 'flddn2pc3E28396xj', emailedAt: 'fldcu4B6pomhUZsUh', noReading: 'fldZNNCoVcWy6zj5T',
};
// The seven MRDC-owned stations, west to east (Winter Operations Management Plan §7).
const STATIONS = [
  { station: 'Longs Creek', where: 'Exit 258, near the EB on ramp' },
  { station: 'Saint John River Bridge', where: 'Western end of the bridge' },
  { station: 'Mill Cove', where: 'Exit 347' },
  { station: 'Fire Road', where: 'km 382, beside the EB lane' },
  { station: 'Dubee Settlement', where: 'km 400, in the median' },
  { station: 'Salisbury', where: 'Exit 433' },
  { station: 'Magnetic Hill', where: 'Exit 450' },
];
const NAMES = STATIONS.map(s => s.station);
const THRESHOLD = 2;                       // °C, either reading (Troy, 2026-10-13)
const LIST = 'RWIS Checks';
const SWITCH = 'RWIS check email';
const TITLES = ['Operations Manager', 'Area Manager'];
const RECENT_DAYS = 30;
const okEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
const normUnit = s => String(s || '').toUpperCase().replace(/[\s\-_.\/]/g, '');

function newId(d = new Date()) {
  const p = C.parts(d), r = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, '0');
  return `RW-${p.date.replace(/-/g, '')}-${String(p.hour).padStart(2, '0')}${String(p.minute).padStart(2, '0')}-${r}`;
}
function temp(v) {
  if (v === '' || v == null) return NaN;
  const n = Number(v);
  return Number.isFinite(n) && n >= -50 && n <= 70 ? Math.round(n * 10) / 10 : NaN;
}
const diff = (rwis, pt) => Math.round((rwis - pt) * 10) / 10;
const flags = (airDiff, roadDiff) => Math.abs(airDiff) >= THRESHOLD - 1e-9 || Math.abs(roadDiff) >= THRESHOLD - 1e-9;
function when(v, now) {
  if (!v) return { at: now };
  const t = new Date(v);
  if (isNaN(t.getTime())) return { error: 'The time is not a time.' };
  if (t.getTime() > now.getTime() + 5 * 60000) return { error: 'The time is in the future.' };
  if (t.getTime() < now.getTime() - 24 * 3600000) return { error: 'The time is more than a day ago — ask a supervisor to enter it in Airtable.' };
  return { at: t };
}

function cleanCheck(b, caller, fleet, now = new Date()) {
  b = b || {};
  const station = String(b.station || '');
  if (!NAMES.includes(station)) return { error: 'Which RWIS station?' };
  const truck = String(b.truck || '').trim();
  if (truck.length < 2 || truck.length > 30) return { error: 'Which patrol truck? (its unit number)' };
  const ptAir = temp(b.ptAir), rwisAir = temp(b.rwisAir), ptRoad = temp(b.ptRoad), rwisRoad = temp(b.rwisRoad);
  const airNA = b.rwisAirNA === true, roadNA = b.rwisRoadNA === true;
  if (isNaN(ptAir)) return { error: 'Give the truck\'s air temperature (°C, e.g. -4.5).' };
  if (!airNA && isNaN(rwisAir)) return { error: 'Give the station\'s air temperature (°C), or tick "No reading".' };
  if (isNaN(ptRoad)) return { error: 'Give the truck\'s road temperature (°C).' };
  if (!roadNA && isNaN(rwisRoad)) return { error: 'Give the station\'s road temperature (°C), or tick "No reading".' };
  const comments = String(b.comments || '').trim();
  if (comments.length > 2000) return { error: 'Keep the comments under 2000 characters.' };
  const checkedBy = String(b.checkedBy || caller.name || '').trim().slice(0, 120);
  if (checkedBy.length < 2) return { error: 'Who did the check?' };
  const t = when(b.checkedAt, now); if (t.error) return { error: t.error };
  const airDiff = airNA ? null : diff(rwisAir, ptAir), roadDiff = roadNA ? null : diff(rwisRoad, ptRoad);
  const off = airNA || roadNA || (airDiff != null && flags(airDiff, 0)) || (roadDiff != null && flags(0, roadDiff));
  const hit = (fleet || []).find(u => normUnit(u.unit) === normUnit(truck));
  return { fields: {
    [F.id]: newId(t.at), [F.station]: station, [F.checkedAt]: t.at.toISOString(),
    [F.truck]: hit ? hit.unit : truck, [F.fleet]: hit ? hit.recId : '',
    [F.ptAir]: ptAir, [F.rwisAir]: airNA ? null : rwisAir, [F.airDiff]: airDiff,
    [F.ptRoad]: ptRoad, [F.rwisRoad]: roadNA ? null : rwisRoad, [F.roadDiff]: roadDiff,
    [F.noReading]: [airNA && 'Air', roadNA && 'Road'].filter(Boolean),
    [F.flagged]: off ? 'Yes' : 'No',
    [F.comments]: comments, [F.checkedBy]: checkedBy, [F.enteredBy]: caller.name || '',
  } };
}
const n = v => (v === undefined || v === null || v === '' ? null : Number(v));
function shape(r) {
  const f = r.fields || {};
  return {
    id: r.id, checkId: f[F.id] || '', station: L.sel(f[F.station]) || '', checkedAt: f[F.checkedAt] || '',
    truck: f[F.truck] || '', fleetRecord: f[F.fleet] || '',
    ptAir: n(f[F.ptAir]), rwisAir: n(f[F.rwisAir]), airDiff: n(f[F.airDiff]),
    ptRoad: n(f[F.ptRoad]), rwisRoad: n(f[F.rwisRoad]), roadDiff: n(f[F.roadDiff]),
    flagged: L.sel(f[F.flagged]) === 'Yes', comments: f[F.comments] || '',
    noReading: L.arr(f[F.noReading]).map(L.sel),
    checkedBy: f[F.checkedBy] || '', enteredBy: f[F.enteredBy] || '',
    emailedTo: f[F.emailedTo] || '', emailedAt: f[F.emailedAt] || '',
  };
}
function recipients(dir) {
  const subs = C.subscribed(dir, LIST);
  if (subs.length) return [...new Set(subs.map(e => e.toLowerCase()))];
  return [...new Set(dir.people.filter(p => p.active && p.titles.some(t => TITLES.includes(t)) && okEmail(p.email))
    .map(p => p.email.toLowerCase()))];
}
const sgn = v => v == null ? 'n/a' : (v > 0 ? '+' : '') + Number(v).toFixed(1);
const gapText = (a, k) => (a.noReading || []).includes(k) ? 'no reading' : sgn(k === 'Air' ? a.airDiff : a.roadDiff) + ' °C';
function dt(iso) { const p = C.parts(new Date(iso)); return `${p.date} ${C.hhmm(iso)}`; }
function message(a, real, preview) {
  const esc = L.esc;
  const st = STATIONS.find(s => s.station === a.station) || {};
  const nr = a.noReading || [];
  const subject = `${preview ? '[TEST] ' : ''}${nr.length ? 'RWIS station not reporting' : 'RWIS station off'} — ${a.station} (air ${gapText(a, 'Air')}, road ${gapText(a, 'Road')})`;
  const row = (label, pt, rw, d) => `<tr><td style="padding:3px 12px 3px 0;color:#555">${label}</td><td style="padding:3px 12px 3px 0">${esc(pt.toFixed(1))} °C</td>
    <td style="padding:3px 12px 3px 0">${rw == null ? '<b style="color:#A32D2D">no reading</b>' : esc(rw.toFixed(1)) + ' °C'}</td>
    <td style="padding:3px 0;${d == null || Math.abs(d) >= THRESHOLD ? 'color:#A32D2D;font-weight:700' : ''}">${d == null ? '—' : esc(sgn(d)) + ' °C'}</td></tr>`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#15243B">
    ${preview ? `<p style="background:#FDF0DD;padding:8px 10px;border-radius:6px"><b>Owner test.</b> With the switch on Everyone this would go to ${real.length} people: ${esc(real.join(', ') || 'nobody — no address found')}.</p>` : ''}
    <h2 style="margin:0 0 6px;color:#A32D2D">${nr.length ? 'RWIS STATION NOT REPORTING' : 'RWIS STATION READING OFF'} — ${esc(a.station)}</h2>
    <p style="margin:0 0 8px">${esc(st.where || '')}. ${nr.length
      ? `The station was offline or not showing ${esc(nr.join(' and ').toLowerCase())} temperature — check the station.`
      : `The station differs from the patrol truck by ${THRESHOLD} °C or more — check the station before relying on its readings.`}</p>
    <table style="border-collapse:collapse;font-size:15px"><tr><td></td><td style="color:#555;padding-right:12px">Truck ${esc(a.truck)}</td><td style="color:#555;padding-right:12px">Station</td><td style="color:#555">Station − truck</td></tr>
      ${row('Air', a.ptAir, a.rwisAir, a.airDiff)}${row('Road', a.ptRoad, a.rwisRoad, a.roadDiff)}</table>
    ${a.comments ? `<p style="margin:8px 0 4px"><b>Comments:</b> ${esc(a.comments)}</p>` : ''}
    <p style="margin:6px 0 4px">Checked ${esc(dt(a.checkedAt))} by ${esc(a.checkedBy)}</p>
    <p style="margin-top:14px"><a href="https://www.mrdc-htra.com/patrol/rwis.html">Open RWIS checks</a></p>
    <p style="font-size:12px;color:#777">From the MRDC Road Patrol app · ${esc(a.checkId)}</p></div>`;
  return { subject, html };
}
async function email(a) {
  const sw = await C.switchFor(SWITCH);
  const dir = await C.directory();
  const real = recipients(dir);
  const { to, preview } = C.deliveryFor(sw.mode, real, dir);
  const { subject, html } = message(a, real, preview);
  let sent = [], reason = '';
  if (to.length) ({ sent, reason } = await L.sendMailDetailed({ to, subject, html }));
  else reason = sw.mode === 'Off' ? 'the RWIS check email switch is Off' : 'no recipient address found';
  const record = sent.length ? (preview ? `Owner test: ${sent.join(', ')} (would go to ${real.length})` : sent.join(', ')) : `not sent — ${reason}`;
  const upd = await L.airtable(`${C.BASE}/${T_RWIS}/${a.id}`, { method: 'PATCH', body: JSON.stringify({ returnFieldsByFieldId: true,
    fields: { [F.emailedTo]: `Flagged ${new Date().toISOString().slice(0, 16)}: ${record}`, [F.emailedAt]: new Date().toISOString() } }) });
  await C.stampSwitch(sw, `${new Date().toISOString().slice(0, 16)} ${a.checkId}: ${record}`);
  return { check: shape(upd), email: { mode: sw.mode, sent: sent.length, wouldReach: real.length, note: record } };
}
async function listRecent(now = new Date()) {
  const out = []; let offset;
  const since = new Date(now.getTime() - RECENT_DAYS * 24 * 3600000).toISOString();
  do {
    const qs = new URLSearchParams();
    qs.set('returnFieldsByFieldId', 'true'); qs.set('pageSize', '100');
    qs.set('filterByFormula', `IS_AFTER({Checked At}, '${since}')`);
    qs.set('sort[0][field]', 'Checked At'); qs.set('sort[0][direction]', 'desc');
    if (offset) qs.set('offset', offset);
    const page = await L.airtable(`${C.BASE}/${T_RWIS}?${qs}`);
    out.push(...(page.records || []).map(shape));
    offset = page.offset;
  } while (offset && out.length < 2000);
  const recent = out.filter(a => a.checkedAt >= since).sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));
  // Each station's latest check in the window — the "stations to check" board.
  const stations = STATIONS.map(s => ({ ...s, last: recent.find(a => a.station === s.station) || null }));
  return { stations, recent, threshold: THRESHOLD };
}

module.exports = async function handler(req, res) {
  if (L.cors(req, res)) return;
  const caller = await requireCaller(req, res);       // before the try (§2b)
  if (!caller) return;
  const Q = req.query || {};
  try {
    if (req.method === 'GET') {
      if (Q.meta) {
        const [patrollers, fleet] = await Promise.all([L.getPatrollers().catch(() => []), P.getFleet().catch(() => [])]);
        return res.status(200).json({ stations: STATIONS, threshold: THRESHOLD,
          trucks: fleet.map(u => ({ unit: u.unit, designation: u.designation || '', depot: u.depot || '' })),
          patrollers: patrollers.map(p => p.name), me: caller.name });
      }
      return res.status(200).json(await listRecent());
    }
    if (req.method === 'POST') {
      const body = L.parseBody(req);
      const fleet = await P.getFleet().catch(() => []);
      const c = cleanCheck(body, caller, fleet);
      if (c.error) return res.status(400).json({ error: c.error });
      const created = shape(await L.airtable(`${C.BASE}/${T_RWIS}`, { method: 'POST', body: JSON.stringify({ returnFieldsByFieldId: true, fields: c.fields }) }));
      if (!created.flagged) return res.status(201).json({ check: created, email: null });
      try { return res.status(201).json(await email(created)); }
      catch (e) { return res.status(201).json({ check: created, emailError: 'Saved, but the email did not go: ' + e.message }); }
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[rwis]', e.message);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
module.exports.__test = { F, T_RWIS, STATIONS, THRESHOLD, LIST, SWITCH, TITLES, cleanCheck, shape, recipients, message, listRecent, diff, flags, newId };
