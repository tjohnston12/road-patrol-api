// api/breakdowns.js — road-patrol-api (Vercel)
//
// Breakdowns for the Road Patrol app (www.mrdc-htra.com/patrol/breakdowns.html). One form, two
// kinds (Troy, 2026-10-08):
//   - PUBLIC VEHICLE broken down or abandoned — replaces DeviceMagic "Break Downs / Abandoned
//     Vehicle". It stays Open until it is cleared from the highway, so other patrollers see
//     what is out there now.
//   - MRDC EQUIPMENT — replaces "MRDC Equipment Break Down Alert" (Fleet DB Break Down Alert).
//     Troy: "the breakdown is very important as it impacts our operations." The unit stays on
//     a "units down now" list until it is back in service — the question the old form could
//     only answer in a comments box ("what can we put on the road tonight?").
// The unit is a Fleet DB Inventory unit (any active series), stored as its number plus the
// record id, the same way the patrol vehicle is (road-patrol-vehicle-from-fleet.md).
// Yes / No questions are selects, so an unanswered one is never a "no" (the old Fleet DB
// checkboxes could not say no).
//
// Email (Troy, 2026-10-08): "patrollers, and management get the equipment breakdown, i can set
// this in the home access app, public vehicles are to keep other patrollers aware and
// management, same set up." Two subscription lists, "Equipment Breakdowns" and "Public
// Breakdowns"; until anyone subscribes, patrollers and management by job title. Two switches in
// Patrol Notifications (Off / Owner test / Everyone). Equipment also emails when the unit is
// back in service. The record is always saved first; an email that fails never loses it.
//
// Base MRDC-HTRA - Road Patrol (app2m7rkP51kLLpbe), table Breakdowns.
//
// GET   /api/breakdowns?meta=1   -> { kinds, routes, directions, depots, plowRoutes, positions, situations,
//                                     fleet, patrollers, me, admin }
// GET   /api/breakdowns          -> { open, recent }   open (oldest first) + closed in the last 30 days
// POST  /api/breakdowns {kind, …}                       -> { breakdown, email }
// POST  /api/breakdowns?id=rec…&action=close {by?, at?, notes?} -> { breakdown, email }

const L = require('./_lib');
const C = require('./_conditions');
const { requireCaller } = require('./_auth');

const T_BD = 'tblr5LJ7LSgXZgj36';
const F = {
  id: 'fldE1MjcLyTbRxryN', kind: 'fld8hzKi6wDcEjY1R', status: 'fldd8RR4GAMw4izj9', situation: 'fldfGGruMHtHOUply',
  vehicle: 'fldC1NzhC1ruASvK9', position: 'fldS6FaYHpuXKMJ1v', aid: 'flddVk7d1gtVSH1Lm', unit: 'fld5Yqfbvble4Yiwj',
  fleet: 'fldzonRmmchLxpbX3', unitDesc: 'fldovsIR1RmosXYS0', depot: 'fldhQTzHUt00sJ4RC', locType: 'fldghDFs0DKSgPF3P',
  route: 'fldJckVeF2h4Phzqo', direction: 'fldVkQzVPn4SAkrAC', km: 'fldoi1PAk4UakyYjq', ramp: 'fldS2y6pLag5fP41y',
  lat: 'flddFAHiQgd2z1PAe', lng: 'fldpi0CUw1y0NWFoH', plowRoutes: 'fldwfGsunYKomPNdb', spare: 'fldZUZdKbNQSFIqpx',
  spareUnit: 'fldik3Pgh1N30jaPV', mechanic: 'fldtTvamk25jfHiKY', tow: 'fldyC2Vbwcp9dRPo5', description: 'fldI8UbGyZv2LqtMY',
  observedAt: 'flddAMfLPg3mryZRO', reportedBy: 'fldG2EXHoLMBMPeot', enteredBy: 'fldnYC215IDRtBOdj',
  closedAt: 'fld5snUYPnQOOVPKf', closedBy: 'fldqeQgHXQfkYyPF9', closeNotes: 'fldAf3N09u4KKJVns', closedEnteredBy: 'fldjBnLgtyfGVRQT7',
  emailedTo: 'fld71snBpOvTWbUHg', emailedAt: 'fldM5pLRgrNdpOjON',
};
const PUBLIC = 'Public vehicle', EQUIP = 'MRDC equipment';
const KINDS = [PUBLIC, EQUIP];
const SITUATIONS = ['Broken down', 'Abandoned'];
const POSITIONS = ['Shoulder', 'Driving lane', 'Ramp / gore', 'Median'];
const ROUTES = ['Route 1', 'Route 2', 'Route 7', 'Route 8'];
const DIRECTIONS = ['EB', 'WB'];
// Equipment depots include Mazerolle (a vehicle and storage depot) — unlike the patrol depots.
const DEPOTS = ['Oromocto', 'Mazerolle', 'Bagdad', 'River Glade'];
const PLOW_ROUTES = ['Oromocto East', 'Oromocto West', 'Mazerolle', 'Route 7', 'Bagdad East', 'Bagdad West', 'River Glade East', 'River Glade West'];
const LOC_TYPES = ['Highway', 'Yard'];
const YN = ['Yes', 'No'];
const LISTS = { [PUBLIC]: 'Public Breakdowns', [EQUIP]: 'Equipment Breakdowns' };
const SWITCHES = { [PUBLIC]: 'Public breakdown email', [EQUIP]: 'Equipment breakdown email' };
// "patrollers, and management" (Troy). Winter patrollers are seasonal and sit Inactive out of
// season, so they count whatever their status — the same rule as the road-conditions alert.
const TITLES = ['Area Manager', 'Operations Manager', 'General / Facility Manager', 'Patroller - Full Time', 'Patroller - Winter'];
const RECENT_DAYS = 30;
const okEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());

/* ---- Fleet DB: every active unit (any series) ---- */
const FLEET_BASE = process.env.FLEET_BASE || 'appLoRJIahB87c2Mf';
const FLEET_TABLE = process.env.FLEET_TABLE || 'tblNiXX7E11K4Gfzy';
const FV = { unit: 'fldVL7P5cZaQO0lLM', status: 'fldY6lnC7p63eInFV', series: 'fldFia5obvtL7hNha', make: 'fldZL42bqcSC2Rrfx',
  model: 'fld9h45yBxzvONcW9', designation: 'fldTGKBaLbEt97Ih6', depot: 'fld5A4dbfBx90FUGw' };
const normUnit = s => String(s || '').toUpperCase().replace(/[\s\-_.\/]/g, '');
let FLEET = null; const FLEET_TTL = 10 * 60 * 1000;
async function getFleet() {
  if (FLEET && Date.now() - FLEET.at < FLEET_TTL) return FLEET.list;
  try {
    const out = []; let offset;
    do {
      const qs = new URLSearchParams();
      qs.set('pageSize', '100'); qs.set('returnFieldsByFieldId', 'true');
      for (const k of Object.values(FV)) qs.append('fields[]', k);
      qs.set('filterByFormula', `{Active / Retired}='Active'`);
      if (offset) qs.set('offset', offset);
      const page = await L.airtable(`${FLEET_BASE}/${FLEET_TABLE}?${qs}`);
      for (const r of page.records || []) {
        const f = r.fields || {}, unit = String(f[FV.unit] || '').trim();
        if (!unit || L.sel(f[FV.status]) !== 'Active') continue;
        out.push({ unit, recId: r.id, series: L.sel(f[FV.series]) || '', make: L.sel(f[FV.make]) || '',
          model: String(f[FV.model] || '').trim(), designation: String(L.sel(f[FV.designation]) || '').trim(), depot: L.sel(f[FV.depot]) || '' });
      }
      offset = page.offset;
    } while (offset);
    out.sort((a, b) => a.unit.localeCompare(b.unit, 'en', { numeric: true }));
    FLEET = { at: Date.now(), list: out };
    return out;
  } catch (_) { return FLEET ? FLEET.list : []; }       // never hold a breakdown up for the fleet list
}
/* Troy, 2026-10-08: "the breakdown alert is primarily used by patrollers to record when SNIC
   equipment is down, one tons, and pickups can be included". The unit picker offers those three,
   SNIC first; any other unit can still be typed, and a typed fleet unit is still recognised.
   SNIC by Fleet DB series: 21 plow trucks, 30 loaders, 33 snow blowers, 40 tow-behind plows,
   50 winter attachments (spreaders, wings, plows, brine — not the TMAs). 12 one tons, 10 pickups. */
const UNIT_GROUPS = [{ key: 'snic', label: 'SNIC equipment' }, { key: 'oneton', label: 'One tons' }, { key: 'pickup', label: 'Pickups' }];
function unitGroup(u) {
  const s = String((u && u.series) || ''), d = String((u && u.designation) || '').toLowerCase();
  if (s === '21' || s === '30') return 'snic';
  if (s === '33') return /snow ?blow/.test(d) ? 'snic' : '';
  if (s === '40') return /plow/.test(d) ? 'snic' : '';
  if (s === '50') return /tma|traffic control/.test(d) ? '' : 'snic';
  if (s === '12') return 'oneton';
  if (s === '10') return 'pickup';
  return '';
}
function fleetForPicker(fleet) {
  const order = k => { const i = UNIT_GROUPS.findIndex(g => g.key === k); return i < 0 ? 99 : i; };
  return fleet.map(u => ({ unit: u.unit, depot: u.depot, series: u.series, description: describeUnit(u), group: unitGroup(u) }))
    .sort((a, b) => order(a.group) - order(b.group) || a.unit.localeCompare(b.unit, 'en', { numeric: true }));
}
function describeUnit(u) {
  if (!u) return '';
  const mm = [u.make, u.model].filter(Boolean);
  if (u.make && u.model && u.model.toLowerCase().startsWith(u.make.toLowerCase())) mm.shift();   // "Chevy Chevy"
  return [mm.join(' '), u.designation].filter(Boolean).join(' · ');
}

function newId(d = new Date()) {
  const p = C.parts(d), r = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, '0');
  return `BD-${p.date.replace(/-/g, '')}-${String(p.hour).padStart(2, '0')}${String(p.minute).padStart(2, '0')}-${r}`;
}
function num(v, lo, hi) {
  if (v === '' || v == null) return NaN;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : NaN;
}
function when(v, now, label) {
  if (!v) return { at: now };
  const t = new Date(v);
  if (isNaN(t.getTime())) return { error: `The ${label} time is not a time.` };
  if (t.getTime() > now.getTime() + 5 * 60000) return { error: `The ${label} time is in the future.` };
  if (t.getTime() < now.getTime() - 24 * 3600000) return { error: `The ${label} time is more than a day ago — ask a supervisor to enter it in Airtable.` };
  return { at: t };
}
/* Route, direction, km, ramp and GPS — required on the highway. */
function place(b) {
  const route = String(b.route || '');
  if (!ROUTES.includes(route)) return { error: 'Pick the route.' };
  const direction = String(b.direction || '');
  if (!DIRECTIONS.includes(direction)) return { error: 'Pick the direction (EB or WB).' };
  const km = num(b.km, 0, 999.9);
  if (isNaN(km)) return { error: 'Give the KM (a number, e.g. 324.6).' };
  const ramp = String(b.ramp || '').trim();
  if (ramp.length > 100) return { error: 'Keep the ramp under 100 characters.' };
  return { fields: { [F.route]: route, [F.direction]: direction, [F.km]: Math.round(km * 10) / 10, [F.ramp]: ramp } };
}
function gps(b) {
  const hasLat = !(b.lat === '' || b.lat == null), hasLng = !(b.lng === '' || b.lng == null);
  if (!hasLat && !hasLng) return { fields: {} };
  const lat = num(b.lat, 40, 50), lng = num(b.lng, -75, -60);
  if (hasLat !== hasLng || isNaN(lat) || isNaN(lng)) return { error: 'The GPS position is not right — tap "Use my location" again or clear it.' };
  return { fields: { [F.lat]: Math.round(lat * 1e6) / 1e6, [F.lng]: Math.round(lng * 1e6) / 1e6 } };
}
const yn = v => YN.includes(String(v)) ? String(v) : '';

function cleanReport(b, caller, fleet, now = new Date()) {
  b = b || {};
  const kind = String(b.kind || '');
  if (!KINDS.includes(kind)) return { error: 'Is it a public vehicle or MRDC equipment?' };
  const description = String(b.description || '').trim();
  if (description.length < 3) return { error: kind === PUBLIC ? 'Describe what you found.' : 'Describe what is wrong with the unit.' };
  if (description.length > 2000) return { error: 'Keep the description under 2000 characters.' };
  const t = when(b.observedAt, now, 'reported'); if (t.error) return { error: t.error };
  const reportedBy = String(b.reportedBy || caller.name || '').trim().slice(0, 120);
  if (reportedBy.length < 2) return { error: 'Who is reporting it?' };
  const g = gps(b); if (g.error) return { error: g.error };
  const fields = {
    [F.id]: newId(t.at), [F.kind]: kind, [F.status]: 'Open', [F.description]: description,
    [F.observedAt]: t.at.toISOString(), [F.reportedBy]: reportedBy, [F.enteredBy]: caller.name || '', ...g.fields,
  };
  if (kind === PUBLIC) {
    const situation = String(b.situation || '');
    if (!SITUATIONS.includes(situation)) return { error: 'Broken down or abandoned?' };
    const position = String(b.position || '');
    if (!POSITIONS.includes(position)) return { error: 'Where is it sitting — shoulder, driving lane, ramp or median?' };
    const aid = yn(b.renderedAid);
    if (!aid) return { error: 'Did you render aid? (Yes or No)' };
    const vehicle = String(b.vehicle || '').trim();
    if (vehicle.length > 160) return { error: 'Keep the vehicle under 160 characters.' };
    const p = place(b); if (p.error) return { error: p.error };
    Object.assign(fields, { [F.situation]: situation, [F.position]: position, [F.aid]: aid, [F.vehicle]: vehicle, [F.locType]: 'Highway' }, p.fields);
    return { fields };
  }
  // MRDC equipment
  const unit = String(b.unit || '').trim();
  if (unit.length < 2 || unit.length > 30) return { error: 'Which unit? (its unit number, e.g. 1621-50)' };
  const hit = (fleet || []).find(u => normUnit(u.unit) === normUnit(unit));
  const depot = String(b.depot || (hit && hit.depot) || '');
  if (!DEPOTS.includes(depot)) return { error: 'Which depot is the unit from?' };
  const locType = String(b.locationType || '');
  if (!LOC_TYPES.includes(locType)) return { error: 'Is it on the highway or in the yard?' };
  const plow = Array.isArray(b.plowRoutes) ? b.plowRoutes.map(String) : [];
  if (plow.some(r => !PLOW_ROUTES.includes(r))) return { error: 'Unknown plow route.' };
  const spare = yn(b.spareDeployed), mech = yn(b.mechanicCalled), tow = yn(b.towCalled);
  if (!spare) return { error: 'Was a spare deployed? (Yes or No)' };
  if (!mech) return { error: 'Was a mechanic called? (Yes or No)' };
  if (!tow) return { error: 'Was a tow called? (Yes or No)' };
  const spareUnit = spare === 'Yes' ? String(b.spareUnit || '').trim().slice(0, 30) : '';
  Object.assign(fields, {
    [F.unit]: hit ? hit.unit : unit, [F.fleet]: hit ? hit.recId : '', [F.unitDesc]: describeUnit(hit),
    [F.depot]: depot, [F.locType]: locType, [F.plowRoutes]: PLOW_ROUTES.filter(r => plow.includes(r)),
    [F.spare]: spare, [F.spareUnit]: spareUnit, [F.mechanic]: mech, [F.tow]: tow,
  });
  if (locType === 'Highway') { const p = place(b); if (p.error) return { error: p.error }; Object.assign(fields, p.fields); }
  return { fields };
}
function cleanClose(b, bd, caller, now = new Date()) {
  b = b || {};
  const label = bd.kind === EQUIP ? 'back in service' : 'cleared';
  const t = when(b.at, now, label); if (t.error) return { error: t.error };
  if (bd.observedAt && t.at.getTime() < new Date(bd.observedAt).getTime()) return { error: 'That is before it was reported.' };
  const by = String(b.by || caller.name || '').trim().slice(0, 120);
  if (by.length < 2) return { error: bd.kind === EQUIP ? 'Who put it back in service?' : 'Who cleared it?' };
  const notes = String(b.notes || '').trim();
  if (notes.length > 2000) return { error: 'Keep the notes under 2000 characters.' };
  return { fields: { [F.status]: 'Closed', [F.closedAt]: t.at.toISOString(), [F.closedBy]: by, [F.closeNotes]: notes, [F.closedEnteredBy]: caller.name || '' } };
}
function shape(r) {
  const f = r.fields || {};
  return {
    id: r.id, breakdownId: f[F.id] || '', kind: L.sel(f[F.kind]) || '', status: L.sel(f[F.status]) || 'Open',
    situation: L.sel(f[F.situation]) || '', vehicle: f[F.vehicle] || '', position: L.sel(f[F.position]) || '', renderedAid: L.sel(f[F.aid]) || '',
    unit: f[F.unit] || '', fleetRecord: f[F.fleet] || '', unitDescription: f[F.unitDesc] || '', depot: L.sel(f[F.depot]) || '',
    locationType: L.sel(f[F.locType]) || '', route: L.sel(f[F.route]) || '', direction: L.sel(f[F.direction]) || '',
    km: f[F.km] ?? null, ramp: f[F.ramp] || '', lat: f[F.lat] ?? null, lng: f[F.lng] ?? null,
    plowRoutes: L.arr(f[F.plowRoutes]).map(L.sel), spareDeployed: L.sel(f[F.spare]) || '', spareUnit: f[F.spareUnit] || '',
    mechanicCalled: L.sel(f[F.mechanic]) || '', towCalled: L.sel(f[F.tow]) || '', description: f[F.description] || '',
    observedAt: f[F.observedAt] || '', reportedBy: f[F.reportedBy] || '', enteredBy: f[F.enteredBy] || '',
    closedAt: f[F.closedAt] || '', closedBy: f[F.closedBy] || '', closeNotes: f[F.closeNotes] || '',
    emailedTo: f[F.emailedTo] || '', emailedAt: f[F.emailedAt] || '',
  };
}
const where = a => a.locationType === 'Yard' ? `${a.depot} yard` : `${a.route} ${a.direction} km ${Number(a.km).toFixed(1)}${a.ramp ? ` (${a.ramp})` : ''}`;

function recipients(dir, kind) {
  const subs = C.subscribed(dir, LISTS[kind]);
  if (subs.length) return [...new Set(subs.map(e => e.toLowerCase()))];
  return [...new Set(dir.people.filter(p => (p.active || p.titles.includes('Patroller - Winter')) &&
    p.titles.some(t => TITLES.includes(t)) && okEmail(p.email)).map(p => p.email.toLowerCase()))];
}
function dt(iso) { const p = C.parts(new Date(iso)); return `${p.date} ${C.hhmm(iso)}`; }
function message(a, event, real, preview) {
  const esc = L.esc, closed = event === 'closed', eq = a.kind === EQUIP;
  const head = eq ? (closed ? `BACK IN SERVICE — ${a.unit}` : `EQUIPMENT DOWN — ${a.unit}`)
                  : (closed ? `CLEARED — ${a.situation.toLowerCase()} vehicle` : `${a.situation.toUpperCase()} VEHICLE`);
  const subject = `${preview ? '[TEST] ' : ''}${eq
    ? `${closed ? 'Back in service' : 'Equipment down'} — ${a.unit}${a.unitDescription ? ` (${a.unitDescription})` : ''}, ${a.depot}`
    : `${a.situation} vehicle — ${where(a)}${a.position ? `, ${a.position.toLowerCase()}` : ''}`}`;
  const map = a.lat != null && a.lng != null ? `https://www.google.com/maps?q=${a.lat},${a.lng}` : '';
  const rows = eq ? [
    ['Unit', `${a.unit}${a.unitDescription ? ` — ${a.unitDescription}` : ''}`], ['Depot', a.depot], ['Where', where(a)],
    ['Plow routes affected', a.plowRoutes.join(', ') || 'none named'],
    ['Spare deployed', a.spareDeployed + (a.spareUnit ? ` (${a.spareUnit})` : '')], ['Mechanic called', a.mechanicCalled], ['Tow called', a.towCalled],
  ] : [
    ['Where', where(a)], ['Sitting', a.position], ['Vehicle', a.vehicle || '—'], ['Aid rendered', a.renderedAid],
  ];
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#15243B">
    ${preview ? `<p style="background:#FDF0DD;padding:8px 10px;border-radius:6px"><b>Owner test.</b> With the switch on Everyone this would go to ${real.length} people: ${esc(real.join(', ') || 'nobody — no address found')}.</p>` : ''}
    <h2 style="margin:0 0 6px;color:${closed ? '#1D7A46' : '#A32D2D'}">${esc(head)}</h2>
    <table style="border-collapse:collapse;font-size:15px">${rows.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#555">${esc(k)}</td><td style="padding:2px 0"><b>${esc(v)}</b></td></tr>`).join('')}</table>
    <p style="margin:8px 0 4px"><b>${eq ? 'What is wrong' : 'Description'}:</b> ${esc(a.description)}</p>
    <p style="margin:0 0 4px">Reported ${esc(dt(a.observedAt))} by ${esc(a.reportedBy)}</p>
    ${closed ? `<p style="margin:8px 0 4px"><b>${eq ? 'Back in service' : 'Cleared'} ${esc(dt(a.closedAt))} by ${esc(a.closedBy)}</b>${a.closeNotes ? ` — ${esc(a.closeNotes)}` : ''}</p>` : ''}
    ${map ? `<p style="margin:0 0 4px"><a href="${esc(map)}">Map (${esc(a.lat)}, ${esc(a.lng)})</a></p>` : ''}
    <p style="margin-top:14px"><a href="https://www.mrdc-htra.com/patrol/breakdowns.html">Open breakdowns</a></p>
    <p style="font-size:12px;color:#777">From the MRDC Road Patrol app · ${esc(a.breakdownId)}</p></div>`;
  return { subject, html };
}
async function email(a, event) {
  const sw = await C.switchFor(SWITCHES[a.kind]);
  const dir = await C.directory();
  const real = recipients(dir, a.kind);
  const { to, preview } = C.deliveryFor(sw.mode, real, dir);
  const { subject, html } = message(a, event, real, preview);
  let sent = [], reason = '';
  if (to.length) ({ sent, reason } = await L.sendMailDetailed({ to, subject, html }));
  else reason = sw.mode === 'Off' ? `the ${SWITCHES[a.kind].toLowerCase()} switch is Off` : 'no recipient address found';
  const record = sent.length ? (preview ? `Owner test: ${sent.join(', ')} (would go to ${real.length})` : sent.join(', ')) : `not sent — ${reason}`;
  const line = `${event === 'closed' ? 'Closed' : 'Reported'} ${new Date().toISOString().slice(0, 16)}: ${record}`;
  const upd = await L.airtable(`${C.BASE}/${T_BD}/${a.id}`, { method: 'PATCH', body: JSON.stringify({ returnFieldsByFieldId: true,
    fields: { [F.emailedTo]: (a.emailedTo ? a.emailedTo + '\n' : '') + line, [F.emailedAt]: new Date().toISOString() } }) });
  await C.stampSwitch(sw, `${new Date().toISOString().slice(0, 16)} ${a.breakdownId} ${event}: ${record}`);
  return { breakdown: shape(upd), email: { mode: sw.mode, sent: sent.length, wouldReach: real.length, note: record } };
}
const mailsOnClose = a => a.kind === EQUIP;       // back in service matters to operations; a cleared car does not need a second email

async function listAll(now = new Date()) {
  const out = []; let offset;
  const since = new Date(now.getTime() - RECENT_DAYS * 24 * 3600000).toISOString();
  do {
    const qs = new URLSearchParams();
    qs.set('returnFieldsByFieldId', 'true'); qs.set('pageSize', '100');
    qs.set('filterByFormula', `OR({Status}='Open', IS_AFTER({Observed At}, '${since}'))`);
    qs.set('sort[0][field]', 'Observed At'); qs.set('sort[0][direction]', 'desc');
    if (offset) qs.set('offset', offset);
    const page = await L.airtable(`${C.BASE}/${T_BD}?${qs}`);
    out.push(...(page.records || []).map(shape));
    offset = page.offset;
  } while (offset && out.length < 2000);
  const open = out.filter(a => a.status === 'Open').sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const recent = out.filter(a => a.status !== 'Open' && a.observedAt >= since).sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  return { open, recent };
}

module.exports = async function handler(req, res) {
  if (L.cors(req, res)) return;
  const caller = await requireCaller(req, res);       // before the try (§2b)
  if (!caller) return;
  const Q = req.query || {};
  try {
    if (req.method === 'GET') {
      if (Q.meta) {
        const [patrollers, fleet] = await Promise.all([L.getPatrollers().catch(() => []), getFleet()]);
        return res.status(200).json({ kinds: KINDS, situations: SITUATIONS, positions: POSITIONS, routes: ROUTES, directions: DIRECTIONS,
          depots: DEPOTS, plowRoutes: PLOW_ROUTES, locationTypes: LOC_TYPES,
          fleet: fleetForPicker(fleet), unitGroups: UNIT_GROUPS,
          patrollers: patrollers.map(p => p.name), me: caller.name, admin: caller.isAdmin });
      }
      return res.status(200).json(await listAll());
    }
    if (req.method === 'POST') {
      const body = L.parseBody(req);
      if (Q.id) {
        if (!/^rec[A-Za-z0-9]{14}$/.test(String(Q.id))) return res.status(400).json({ error: 'Bad id' });
        if (Q.action !== 'close') return res.status(400).json({ error: 'Unknown action' });
        const qs = new URLSearchParams(); qs.set('returnFieldsByFieldId', 'true');
        const bd = shape(await L.airtable(`${C.BASE}/${T_BD}/${Q.id}?${qs}`));
        if (bd.status === 'Closed') return res.status(409).json({ error: `Already ${bd.kind === EQUIP ? 'back in service' : 'cleared'} — ${dt(bd.closedAt)} by ${bd.closedBy}.`, breakdown: bd });
        const c = cleanClose(body, bd, caller);
        if (c.error) return res.status(400).json({ error: c.error });
        const upd = shape(await L.airtable(`${C.BASE}/${T_BD}/${bd.id}`, { method: 'PATCH', body: JSON.stringify({ returnFieldsByFieldId: true, fields: c.fields }) }));
        if (!mailsOnClose(upd)) return res.status(200).json({ breakdown: upd, email: null });
        try { return res.status(200).json(await email(upd, 'closed')); }
        catch (e) { return res.status(200).json({ breakdown: upd, emailError: 'Saved, but the email did not go: ' + e.message }); }
      }
      const fleet = body && body.kind === EQUIP ? await getFleet() : [];
      const c = cleanReport(body, caller, fleet);
      if (c.error) return res.status(400).json({ error: c.error });
      const created = shape(await L.airtable(`${C.BASE}/${T_BD}`, { method: 'POST', body: JSON.stringify({ returnFieldsByFieldId: true, fields: c.fields }) }));
      try { return res.status(201).json(await email(created, 'reported')); }
      catch (e) { return res.status(201).json({ breakdown: created, emailError: 'Saved, but the email did not go: ' + e.message }); }
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[breakdowns]', e.message);
    return res.status(e.status === 404 ? 404 : 500).json({ error: e.status === 404 ? 'Not found' : (e.message || 'Server error') });
  }
};
module.exports.__test = { unitGroup, fleetForPicker, UNIT_GROUPS, F, T_BD, PUBLIC, EQUIP, KINDS, SITUATIONS, POSITIONS, ROUTES, DIRECTIONS, DEPOTS, PLOW_ROUTES, TITLES, LISTS, SWITCHES,
  newId, cleanReport, cleanClose, shape, recipients, message, listAll, getFleet, describeUnit, resetFleet: () => { FLEET = null; } };
