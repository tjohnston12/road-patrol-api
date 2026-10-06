// api/mva.js — road-patrol-api (Vercel)
//
// MVA notifications for the MRDC Road Patrol app (www.mrdc-htra.com/patrol/).
// Base: MRDC-HTRA - MVA (appMKaiabPAPx3JaV), table MVA Notifications.
//
// GET   /api/mva                 -> { rows, scope }  newest first
// GET   /api/mva?id=<rec>        -> { row }
// GET   /api/mva?mine=1          -> only the caller's own notifications
// GET   /api/mva?meta=1          -> { choices }
// POST  /api/mva                 -> file a notification (assigns the MVA No., emails the list)
// POST  /api/mva {action:'upload', id, filename, contentType, data} -> attach a photo
// PATCH /api/mva { id, ... }     -> update status / DMT work order no. (supervisors)
//
// THE MVA No. is the claim key: YYYY-MM-DD-KM-DIRECTION, e.g. 2026-08-18-325.250-EB.
// It is generated SERVER-SIDE from date + km + direction so it cannot be forged or
// typo'd by the client, and a collision (two MVAs at the same spot on the same day)
// gets a -2, -3 … suffix rather than silently overwriting.
//
// Env: AIRTABLE_PAT (read+write on the MVA base, read on Employees), MVA_BASE,
//      MVA_TABLE. For the notification email: RESEND_API_KEY, MVA_NOTIFY_TO
//      (comma-separated; defaults to the Accident Group), MVA_FROM (a
//      Resend-verified sender), PATROL_APP_URL. With RESEND_API_KEY unset the
//      app still works — the notification is recorded and simply not emailed.

const L = require('./_lib');
const { requireCaller } = require('./_auth');
const C = require('./_conditions');   // the Patrol Notifications switch (Off / Owner test / Everyone)

const BASE  = process.env.MVA_BASE  || 'appMKaiabPAPx3JaV';
const TABLE = process.env.MVA_TABLE || 'tblFnoVfyA9nSEOwk';
const LIMIT = Number(process.env.MVA_LIMIT || 400);
const APP_URL = process.env.PATROL_APP_URL || 'https://www.mrdc-htra.com/patrol/';

// Where the MVA notification goes. "Accident Group" is the existing MRDC
// distribution list; MVA_NOTIFY_TO overrides it (comma-separated) without a
// code change. NOTE for deploy: the group must accept mail from the Resend
// sender domain, or Microsoft 365 will reject it as an external sender.
const NOTIFY_TO = process.env.MVA_NOTIFY_TO || 'AccidentGroup2@mrdc.ca';
const SWITCH = 'MVA notification';   // the row in Patrol Notifications

const F = {
  mvaNo:          'flddJ5v5jZ9rv4VWg', // primary
  occurredAt:     'fldyNaXuFj9LTbelQ',
  date:           'fld8dDEK0xlJqPUzS',
  patroller:      'fld52QNBDHZQfx5za',
  patrollerEmail: 'fldlCV1Cyknry8KQf',
  division:       'fldgIA9dpSAllebrF',
  route:          'fldCbe3KQ2xm7Dgs3',
  km:             'fld6p5ivQNf8K0BSV',
  direction:      'fldypZa9PK1hyT6OU',
  ramp:           'fldccbyLLRrNu5wOg',
  gps:            'fldusfufZWR2nTR6U',
  vehicles:       'fldiz7z6SHfSHlu0V',
  services:       'fldP9hzvrOmCXxK58',
  policeFile:     'fldB1VOZzQ0VXfhoZ',
  injuries:       'fldoXOkzROQBIRo4d',
  fatality:       'fld2h81Yn4jpfQUAz',
  spill:          'fld75MhzYB29Rhmqw',
  doeCalled:      'fldrqnH2ujA493AGT',
  spillDetails:   'fldtMo6Ka4FwEqplo',
  fire:           'fldKZghdMOKEUXt5k',
  damages:        'fld9iwXIi9fetqCjI',
  damageDesc:     'fldFKDBopABcL4M6B',
  hitRun:         'fldWIW6ejsJGjrMCM',
  extensiveTC:    'fldP4p8salI5YRkwU',
  blocked:        'fldDZGvitTgzAtNcX',
  lanes:          'fldD7oUvWiKXgp8pJ',
  towGo:          'fldqtxSnxcn6F8dr5',
  towCompany:     'fldbLjxObcRB1H40i',
  redLights:      'fldNSkU6u9GOBrFbJ',
  pinkSign:       'fldMgoA4Uf3RxJ4gC',
  roadkill:       'fld1bLiWFwhyUFs7p',
  animalType:     'fldK4kaCURlAhHbf3',
  animalCount:    'fldAsBgbvYvH0BFwZ',
  photos:         'fldXN5USProy2fNVx',
  summary:        'fldQBjjZNYPVpUaaW',
  dmtWo:          'fldh1qB5gUhhPlrxS',
  status:         'fldNRjvZEFolYv9uq',
  notifiedAt:     'fldCFjoigjFgQwuv5',
  notified:       'fld2uqP1UINkICedW',
  source:         'fldUIYdN0KxkhLCG4',
  submittedBy:    'fldXlKWDYku5DvKJB',
  submittedAt:    'fldszDjdbsTOo5ZK0',
  arRequired:     'fldCZCNzveE8f62gi', // formula
  invRequired:    'fldd0JXy6NKliOKAd', // formula
  accidentReport: 'fldFOsb5XhmutWECX', // reverse link -> Accident Reports
  investigation:  'fldzrZmDoSX2oDx6v', // reverse link -> Investigations
  // Filing with insurance — the end of the patroller's part (added 2026-10-06).
  filedDate:      'fldIUbZxpDiRFY4VC', // date
  filedInsurer:   'fld5cVD0rOTNZ35l9',
  claimNo:        'fldPuYIFTuu8A59pz',
  filedBy:        'fldjIytSPIpJDAhr8',
  filedAt:        'fld9iUoLpAiaNRU7x',
  // The accident file's route (2026-10-06): patroller → manager verifies →
  // Operations Manager approves → Claims Manager files with insurance → paid.
  stage:          'fldelaGXvgjkSNxpH',
  history:        'fldGYosJk4ajH70iq',
  fileSubBy:      'fldXx2X2nyuWF1PMu',
  fileSubAt:      'fldaF44XoudOvZtc6',
  verifiedBy:     'fld8AmIv1nazO3RZa',
  verifiedAt:     'fldjd8H86b7knFBjg',
  approvedBy:     'fld0BDyLCooClS1fj',
  approvedAt:     'fld0UlANpSaFDgtyr',
  sentBackNote:   'fldx4tHHCSKrUIuJL',
  paidDate:       'fldP5WqwAuKVhvSMd',
  paidAmount:     'fldgJYeGT2PxIWOBz',
};

const CHOICES = {
  divisions:  ['Eastern', 'Western'],
  routes:     ['Route 2', 'Route 7', 'Other'],
  directions: ['EB', 'WB', 'NB', 'SB'],
  services:   ['Police (RCMP)', 'Ambulance', 'Fire', 'Dept. of Environment', 'Tow', 'DTI', 'None'],
  // 'Ramp' added 2026-10-06 (Troy: "for lanes blocked on mva can you add Ramp").
  lanes:      ['Shoulder only', 'One lane', 'Both lanes', 'Ramp', 'Full closure'],
  animals:    ['Deer', 'Moose', 'Bear', 'Coyote', 'Fox', 'Other'],
  statuses:   ['Notified', 'Accident report started', 'Under investigation',
               'Repairs pending', 'Ready for claim', 'Closed'],
};

const { arr, sel, num, esc, airtable } = L;

function shape(rec) {
  const f = rec.fields || {};
  return {
    id:             rec.id,
    mvaNo:          f[F.mvaNo] || '',
    occurredAt:     f[F.occurredAt] || '',
    date:           f[F.date] || '',
    patroller:      f[F.patroller] || '',
    patrollerEmail: f[F.patrollerEmail] || '',
    division:       sel(f[F.division]),
    route:          sel(f[F.route]),
    km:             f[F.km] != null ? f[F.km] : null,
    direction:      sel(f[F.direction]),
    ramp:           f[F.ramp] || '',
    gps:            f[F.gps] || '',
    vehicles:       f[F.vehicles] != null ? f[F.vehicles] : null,
    services:       arr(f[F.services]).map(sel),
    policeFile:     f[F.policeFile] || '',
    injuries:       !!f[F.injuries],
    fatality:       !!f[F.fatality],
    spill:          !!f[F.spill],
    doeCalled:      !!f[F.doeCalled],
    spillDetails:   f[F.spillDetails] || '',
    fire:           !!f[F.fire],
    damages:        !!f[F.damages],
    damageDesc:     f[F.damageDesc] || '',
    hitRun:         !!f[F.hitRun],
    extensiveTC:    !!f[F.extensiveTC],
    blocked:        !!f[F.blocked],
    lanes:          sel(f[F.lanes]),
    towGo:          !!f[F.towGo],
    towCompany:     f[F.towCompany] || '',
    redLights:      !!f[F.redLights],
    pinkSign:       !!f[F.pinkSign],
    roadkill:       !!f[F.roadkill],
    animalType:     sel(f[F.animalType]),
    animalCount:    f[F.animalCount] != null ? f[F.animalCount] : null,
    photos:         arr(f[F.photos]).map(a => ({ id: a.id, url: a.url, filename: a.filename, thumb: a.thumbnails?.small?.url || '' })),
    summary:        f[F.summary] || '',
    dmtWo:          f[F.dmtWo] || '',
    status:         sel(f[F.status]) || 'Notified',
    notifiedAt:     f[F.notifiedAt] || '',
    notified:       f[F.notified] || '',
    source:         sel(f[F.source]) || 'Road Patrol app',
    submittedBy:    f[F.submittedBy] || '',
    submittedAt:    f[F.submittedAt] || '',
    arRequired:     f[F.arRequired] === 'Yes',
    invRequired:    f[F.invRequired] === 'Yes',
    hasAccidentReport:  arr(f[F.accidentReport]).length > 0,
    hasInvestigation:   arr(f[F.investigation]).length > 0,
    filedDate:      f[F.filedDate] || '',
    filedInsurer:   f[F.filedInsurer] || '',
    claimNo:        f[F.claimNo] || '',
    filedBy:        f[F.filedBy] || '',
    filedAt:        f[F.filedAt] || '',
    stage:          sel(f[F.stage]) || 'Open',
    history:        f[F.history] || '',
    fileSubmittedBy: f[F.fileSubBy] || '',
    fileSubmittedAt: f[F.fileSubAt] || '',
    verifiedBy:     f[F.verifiedBy] || '',
    verifiedAt:     f[F.verifiedAt] || '',
    approvedBy:     f[F.approvedBy] || '',
    approvedAt:     f[F.approvedAt] || '',
    sentBackNote:   f[F.sentBackNote] || '',
    paidDate:       f[F.paidDate] || '',
    paidAmount:     f[F.paidAmount] != null ? f[F.paidAmount] : null,
    createdTime:    rec.createdTime,
  };
}

// ─── The MVA No. ───────────────────────────────────────────────────────────
// YYYY-MM-DD-KM-DIRECTION with the km to 3 decimals: 2026-08-18-325.250-EB.
function buildMvaNo(date, km, direction) {
  return `${String(date).slice(0, 10)}-${Number(km).toFixed(3)}-${String(direction).toUpperCase()}`;
}
// Two MVAs can genuinely happen at the same spot on the same day; suffix rather
// than collide, so the number stays unique and nothing is overwritten.
async function uniqueMvaNo(base) {
  for (let i = 1; i <= 20; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    const qs = new URLSearchParams();
    qs.set('maxRecords', '1');
    qs.set('returnFieldsByFieldId', 'true');
    qs.set('filterByFormula', `{MVA No.}='${candidate.replace(/'/g, "\\'")}'`);
    const j = await airtable(`${BASE}/${encodeURIComponent(TABLE)}?${qs}`);
    if (!(j.records || []).length) return candidate;
  }
  throw new Error('Could not allocate a unique MVA number');
}

// The patroller's email from the Employees directory (exact name, any status —
// a winter patroller can be Inactive off-season). '' when not found.
async function directoryEmail(name) {
  const want = String(name || '').trim().toLowerCase();
  if (!want) return '';
  const p = (await L.getEmployees()).find(e => String(e.name || '').trim().toLowerCase() === want);
  return (p && p.email) || '';
}
// The distribution list plus the patroller, once each.
function recipients(list, extra) {
  const out = [], seen = new Set();
  for (const a of String(list || '').split(',').concat(extra ? [extra] : [])) {
    const t = a.trim(); if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase()); out.push(t);
  }
  return out;
}

function toFields(b, mvaNo) {
  const f = {};
  const pick = (list, v) => (list.includes(v) ? v : undefined);
  const pickMany = (list, vs) => arr(vs).filter(v => list.includes(v));
  const set = (k, v) => { if (v !== undefined && v !== '') f[k] = v; };
  const n = (k, v) => { const x = num(v); if (x !== undefined) f[k] = x; };

  f[F.mvaNo] = mvaNo;
  set(F.occurredAt,     b.occurredAt);
  set(F.date,           b.date);
  set(F.patroller,      b.patroller);
  set(F.patrollerEmail, b.patrollerEmail);
  set(F.division,       pick(CHOICES.divisions,  b.division));
  set(F.route,          pick(CHOICES.routes,     b.route));
  set(F.direction,      pick(CHOICES.directions, b.direction));
  set(F.lanes,          pick(CHOICES.lanes,      b.lanes));
  set(F.animalType,     pick(CHOICES.animals,    b.animalType));
  set(F.ramp,           b.ramp);
  set(F.gps,            b.gps);
  set(F.policeFile,     b.policeFile);
  set(F.spillDetails,   b.spillDetails);
  set(F.damageDesc,     b.damageDesc);
  set(F.towCompany,     b.towCompany);
  set(F.summary,        b.summary);
  set(F.submittedBy,    b.submittedBy);
  n(F.km,          b.km);
  n(F.vehicles,    b.vehicles);
  n(F.animalCount, b.animalCount);
  if (b.services !== undefined) f[F.services] = pickMany(CHOICES.services, b.services);

  // Checkboxes always written, so an unticked box records a real "no".
  [['injuries','injuries'],['fatality','fatality'],['spill','spill'],['doeCalled','doeCalled'],
   ['fire','fire'],['damages','damages'],['hitRun','hitRun'],['extensiveTC','extensiveTC'],
   ['blocked','blocked'],['towGo','towGo'],['redLights','redLights'],['pinkSign','pinkSign'],
   ['roadkill','roadkill']].forEach(([key, prop]) => { f[F[key]] = !!b[prop]; });

  f[F.source]      = 'Road Patrol app';
  f[F.status]      = 'Notified';
  f[F.submittedAt] = new Date().toISOString();
  return f;
}

// ─── Notification email ────────────────────────────────────────────────────
function flagList(row) {
  const flags = [];
  if (row.fatality)    flags.push('FATALITY');
  if (row.injuries)    flags.push('Injuries');
  if (row.fire)        flags.push('Fire');
  if (row.spill)       flags.push('Spill' + (row.doeCalled ? ' (Dept. of Environment called)' : ' — DEPT. OF ENVIRONMENT NOT YET CALLED'));
  if (row.damages)     flags.push('Damages to facility');
  if (row.hitRun)      flags.push('Hit &amp; run');
  if (row.blocked)     flags.push('Highway blocked' + (row.lanes ? ' — ' + esc(row.lanes) : ''));
  if (row.extensiveTC) flags.push('Extensive traffic control');
  return flags;
}

function notificationHtml(row) {
  const flags = flagList(row);
  const serious = row.fatality || row.injuries || row.spill || row.fire || row.damages;
  const rows = [
    ['MVA No.', row.mvaNo],
    ['When', row.occurredAt ? String(row.occurredAt).replace('T', ' ').slice(0, 16) : row.date],
    ['Where', [row.route, row.km != null ? 'km ' + Number(row.km).toFixed(3) : '', row.direction, row.ramp].filter(Boolean).join(' · ')],
    ['Division', row.division],
    ['Patroller', row.patroller],
    ['Vehicles involved', row.vehicles != null ? String(row.vehicles) : '—'],
    ['Emergency services', (row.services || []).join(', ') || 'None'],
    ['Police file no.', row.policeFile || '—'],
    ['Tow', row.towGo ? (row.towCompany || 'Yes') : 'No'],
  ];
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:640px">
  <div style="background:#1E2B5E;color:#fff;padding:16px 20px;border-bottom:3px solid #C9A84C">
    <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.65)">MRDC Road Patrol</div>
    <div style="font-size:20px;font-weight:600;margin-top:2px">MVA Notification — ${esc(row.mvaNo)}</div>
  </div>
  ${flags.length ? `<div style="background:${serious ? '#FBEBEB' : '#FAF0DA'};border-left:4px solid ${serious ? '#A32D2D' : '#B7791F'};padding:12px 16px;margin:0">
    <b style="color:${serious ? '#A32D2D' : '#B7791F'}">${flags.join(' &nbsp;·&nbsp; ')}</b></div>` : ''}
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    ${rows.map(([k, v]) => `<tr><td style="padding:7px 0;color:#6B6B6B;width:170px;vertical-align:top">${esc(k)}</td>
      <td style="padding:7px 0;font-weight:500">${esc(v || '—')}</td></tr>`).join('')}
  </table>
  ${row.summary ? `<div style="background:#f7f7f5;border:1px solid #DDD9D0;border-radius:8px;padding:12px 14px;white-space:pre-wrap">${esc(row.summary)}</div>` : ''}
  ${row.damages && row.damageDesc ? `<p style="margin-top:14px"><b>Damage:</b> ${esc(row.damageDesc)}</p>` : ''}
  ${row.arRequired ? `<p style="margin-top:14px;color:#A32D2D"><b>An accident report is required for this MVA.</b></p>` : ''}
  ${row.invRequired ? `<p style="margin-top:6px;color:#A32D2D"><b>Hit &amp; run — an investigation report is required.</b></p>` : ''}
  ${row.damages ? `<p style="margin-top:6px;color:#B7791F"><b>Facility damage must be raised in the DMT as a work order.</b></p>` : ''}
  ${row.arRequired ? folderHtml(row) : ''}
  <p style="margin-top:18px;font-size:13px"><a href="${esc(APP_URL)}" style="color:#15616D">Open the Road Patrol app</a></p>
  <p style="margin-top:14px;font-size:12px;color:#6B6B6B">Filed by ${esc(row.submittedBy || row.patroller)} via the MRDC Road Patrol app.</p>
</div>`;
}

function testBanner(real) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#FAF0DA;border-left:4px solid #B7791F;padding:12px 16px;margin-bottom:12px;max-width:640px">
    <b>Test.</b> The MVA notification is set to <b>Owner test</b> in the Road Patrol base (Patrol Notifications), so only you got this.
    It would have gone to: ${esc(real.join(', ') || 'nobody')}.</div>`;
}

// The accident file folder — what the patroller builds so a claim can be filed.
// The items are the Accident Claim Checklist (3.1.2 Accident Claim Work Summary).
// The Item names are stored on each MVA File Folder row — renaming one orphans
// the rows already saved under the old name.
const FOLDER = [
  { item: 'Accident Report',                 hint: 'The on-scene report: driver, vehicle, insurance and damages.' },
  { item: 'Accident Claim Work Summary',     hint: 'Response hours and equipment, traffic control and repair labour.' },
  { item: 'Accident photos and damages',     hint: '' },
  { item: 'Photos of the completed repairs', hint: '' },
  { item: 'Traffic control sheets',          hint: '' },
  { item: 'Copy of the time sheets',         hint: '' },
  { item: 'Accident Claim Checklist',        hint: 'Signed by the patroller and the Area Manager.' },
];
const ITEMS = FOLDER.map(x => x.item);
function folderHtml(row) {
  return `<div style="margin-top:16px;border:1px solid #DDD9D0;border-radius:8px;padding:12px 16px">
    <div style="font-weight:600;margin-bottom:6px">Accident file folder — ${esc(row.mvaNo)}</div>
    <div style="font-size:13px;color:#6B6B6B;margin-bottom:6px">${esc(row.patroller || 'The patroller')} builds and completes the folder for this MVA:</div>
    <ul style="margin:0;padding-left:20px">${FOLDER.map(i => `<li style="padding:2px 0">${esc(i.item)}${i.hint ? ' — ' + esc(i.hint) : ''}</li>`).join('')}</ul>
    <div style="margin-top:8px;font-size:13px"><a href="${esc(APP_URL)}mvas.html?id=${encodeURIComponent(row.id)}" style="color:#15616D">Open the folder in the Road Patrol app</a></div></div>`;
}

// ── The folder rows (MVA File Folder) ─────────────────────────────────────────
const T_FOLDER = process.env.MVA_FOLDER_TABLE || 'tbl9VS7Ggu8UKCeXU';
const FF = { key: 'fld0beeAYR8nhCJX7', mva: 'fldgBEhKPojKUDyiq', mvaNo: 'fldZ6jtW2k7LqxPe0', item: 'fldLCZxKhdozk8fhk',
  done: 'fldUjL1uELhKd5O3P', doneBy: 'fldv9yBGj0fMQglnx', doneAt: 'fldEv5ndR6kFEojtP', files: 'fldX1QOIze3KlNiT1',
  notes: 'fld0HKIYmCVg8XA3I', updatedBy: 'fld6IhCHIoF9YjE10', updatedAt: 'fldQVnAa268exkeJq' };
const itemKey = (mvaNo, item) => `${mvaNo} · ${item}`;
function shapeItem(rec) {
  const f = rec.fields || {};
  return { id: rec.id, item: f[FF.item] || '', done: !!f[FF.done], doneBy: f[FF.doneBy] || '', doneAt: f[FF.doneAt] || '',
    notes: f[FF.notes] || '', updatedBy: f[FF.updatedBy] || '', updatedAt: f[FF.updatedAt] || '',
    files: arr(f[FF.files]).map(a => ({ id: a.id, url: a.url, filename: a.filename, type: a.type || '', size: a.size || 0,
      thumb: a.thumbnails?.large?.url || a.thumbnails?.small?.url || '' })) };
}
async function folderRows(mvaNo) {
  const out = []; let offset;
  do {
    const qs = new URLSearchParams();
    qs.set('pageSize', '100'); qs.set('returnFieldsByFieldId', 'true');
    if (mvaNo) qs.set('filterByFormula', `{MVA No.}='${String(mvaNo).replace(/'/g, "\\'")}'`);
    if (offset) qs.set('offset', offset);
    const page = await airtable(`${BASE}/${T_FOLDER}?${qs}`);
    out.push(...(page.records || [])); offset = page.offset;
  } while (offset);
  return out;
}
// The folder as the page shows it: every item, in order, saved or not.
function folderView(row, recs) {
  const by = {}; for (const r of recs) { const it = shapeItem(r); if (ITEMS.includes(it.item)) by[it.item] = it; }
  const items = FOLDER.map(x => Object.assign({ item: x.item, hint: x.hint, done: false, files: [], notes: '' }, by[x.item] || {}, { hint: x.hint }));
  return { items, done: items.filter(i => i.done).length, total: items.length };
}
async function upsertItem(row, item, fields) {
  const recs = await folderRows(row.mvaNo);
  const hit = recs.find(r => (r.fields || {})[FF.item] === item);
  if (hit) return airtable(`${BASE}/${T_FOLDER}/${hit.id}`, { method: 'PATCH',
    body: JSON.stringify({ fields, returnFieldsByFieldId: true }) });
  return airtable(`${BASE}/${T_FOLDER}`, { method: 'POST', body: JSON.stringify({ returnFieldsByFieldId: true,
    fields: Object.assign({ [FF.key]: itemKey(row.mvaNo, item), [FF.mva]: [row.id], [FF.mvaNo]: row.mvaNo, [FF.item]: item }, fields) }) });
}

// ── Who may see and act on an accident file (2026-10-06) ─────────────────────
// Troy: "the mva file will go to the manager for verification, then the Operations
// Manager (Mike Park) for approval, then it will be sent to the Claims Manager (Jay
// McInnis) who will process the claim with the insurance company."
//   · the patroller (Patroller or Submitted By) builds it while it is Open / Sent back;
//   · the verifier is the patroller's Manager on their Employees record — with no
//     manager on file, the Operations Manager verifies;
//   · the approver and the claims manager are named in MVA File Roles, so the
//     people can change without a code change;
//   · an admin (isAdmin, unchanged) can see and do everything.
const T_ROLES = process.env.MVA_ROLES_TABLE || 'tblN3F3YU9lg0K6Fz';
const RF = { role: 'fldR6WX7zZziNhIEH', emp: 'fldcd2tacVtpOaA0P' };
const EMP_MANAGER = 'fld06i7CJWbkIbCZA';
const norm = n => String(n || '').trim().toLowerCase();
const STAGES = ['Open', 'Awaiting verification', 'Awaiting approval', 'With claims', 'Filed with insurance', 'Paid', 'Sent back'];
const EDITABLE = ['Open', 'Sent back'];
async function team(ctx) {
  ctx = ctx || {};
  if (ctx.team) return ctx.team;
  const people = []; let offset;
  do {
    const qs = new URLSearchParams();
    qs.set('pageSize', '100'); qs.set('returnFieldsByFieldId', 'true');
    for (const k of ['name', 'email', 'active']) qs.append('fields[]', L.EF[k]);
    qs.append('fields[]', EMP_MANAGER);
    if (offset) qs.set('offset', offset);
    const page = await airtable(`${L.EMP_BASE}/${encodeURIComponent(L.EMP_TABLE)}?${qs}`);
    for (const r of page.records || []) {
      const f = r.fields || {}, m = f[EMP_MANAGER];
      people.push({ name: f[L.EF.name] || '', email: String(f[L.EF.email] || '').trim(), active: sel(f[L.EF.active]) !== 'Inactive',
        manager: Array.isArray(m) ? String((m[0] && (m[0].name || m[0])) || '') : String(m || '') });
    }
    offset = page.offset;
  } while (offset);
  const roles = { ops: '', claims: '' };
  try {
    const qs = new URLSearchParams(); qs.set('returnFieldsByFieldId', 'true');
    const page = await airtable(`${BASE}/${T_ROLES}?${qs}`);
    for (const r of page.records || []) {
      const f = r.fields || {}, role = norm(f[RF.role]);
      if (role === 'operations manager') roles.ops = String(f[RF.emp] || '').trim();
      if (role === 'claims manager') roles.claims = String(f[RF.emp] || '').trim();
    }
  } catch (_) { /* no roles table: only admins approve / handle claims */ }
  const byName = {}; for (const p of people) byName[norm(p.name)] = p;
  ctx.team = { people, roles, byName,
    emailOf: n => ((byName[norm(n)] || {}).email || ''),
    managerOf: n => ((byName[norm(n)] || {}).manager || '') };
  return ctx.team;
}
// The verifier's name for this MVA ('' if nobody — then the approver verifies).
function verifierName(row, t) { return t.managerOf(row.patroller) || t.managerOf(row.submittedBy) || t.roles.ops || ''; }
function accessFor(row, caller, t) {
  const me = norm(caller.name);
  const a = {
    admin: !!caller.isAdmin,
    own: !!me && [row.patroller, row.submittedBy].some(n => norm(n) === me),
    verifier: !!me && norm(verifierName(row, t)) === me,
    approver: !!me && norm(t.roles.ops) === me,
    claims: !!me && norm(t.roles.claims) === me,
  };
  a.view = a.admin || a.own || a.verifier || a.approver || a.claims;
  a.edit = a.admin || (a.own && EDITABLE.includes(row.stage));
  // What this person is being asked to do with it now.
  a.action = row.stage === 'Awaiting verification' && (a.verifier || a.admin) ? 'verify'
    : row.stage === 'Awaiting approval' && (a.approver || a.admin) ? 'approve'
    : row.stage === 'With claims' && (a.claims || a.admin) ? 'file'
    : row.stage === 'Filed with insurance' && (a.claims || a.admin) ? 'paid'
    : EDITABLE.includes(row.stage) && (a.own || a.admin) ? 'build' : '';
  return a;
}
function ownsMva(row, caller) {   // kept for callers that only know the patroller rule
  if (caller.isAdmin) return true;
  const me = norm(caller.name);
  return !!me && [row.patroller, row.submittedBy].some(n => norm(n) === me);
}
async function loadOwned(id, caller, ctx) {
  if (!id || !/^rec[A-Za-z0-9]{14}$/.test(String(id))) return null;
  let rec; try { rec = await airtable(`${BASE}/${encodeURIComponent(TABLE)}/${encodeURIComponent(id)}?returnFieldsByFieldId=true`); }
  catch (e) { if (e.status === 404 || e.status === 403) return null; throw e; }
  const row = shape(rec);
  const t = await team(ctx);
  row.access = accessFor(row, caller, t);
  row.verifier = verifierName(row, t);
  return row.access.view ? row : null;
}
const canEdit = row => !!(row && row.access && row.access.edit);
const NOT_FOUND = { error: 'MVA not found' };

async function fetchRows({ mine, who }) {
  const rows = [];
  let offset;
  do {
    const qs = new URLSearchParams();
    qs.set('pageSize', '100');
    qs.set('returnFieldsByFieldId', 'true');
    qs.set('sort[0][field]', F.date);
    qs.set('sort[0][direction]', 'desc');
    /* ⚠️ Same fail-open as patrol.js fetchRows — see the note there. `mine`
       with no name must return nothing, not everything. */
    if (mine) {
      if (!who) return [];
      const safe = String(who).toLowerCase().replace(/'/g, "\\'");
      qs.set('filterByFormula', `OR(LOWER({Patroller}&'')='${safe}',LOWER({Submitted By}&'')='${safe}')`);
    }
    if (offset) qs.set('offset', offset);
    const page = await airtable(`${BASE}/${encodeURIComponent(TABLE)}?${qs}`);
    rows.push(...(page.records || []));
    offset = rows.length < LIMIT ? page.offset : null;
  } while (offset);
  return rows.slice(0, LIMIT);
}

module.exports = async function handler(req, res) {
  if (L.cors(req, res)) return;
  if (!L.PAT) return res.status(500).json({ error: 'Server not configured (AIRTABLE_PAT missing)' });

  // ⚠️ Identity BEFORE the try — see the note in patrol.js.
  const caller = await requireCaller(req, res);
  if (!caller) return;

  try {
    if (req.method === 'GET') {
      if (String(req.query?.meta || '') === '1') {
        return res.status(200).json({ choices: { ...CHOICES, patrollers: await L.getPatrollers() } });
      }
      const id = req.query?.id;
      if (id) {
        // Not theirs, or no such record: the same 404, so a guessed id says nothing.
        const ctx = {};
        const row = await loadOwned(id, caller, ctx);
        if (!row) return res.status(404).json(NOT_FOUND);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ row, folder: folderView(row, await folderRows(row.mvaNo)), admin: !!caller.isAdmin,
          photos: await photosFor(row), roles: { ops: ctx.team.roles.ops, claims: ctx.team.roles.claims } });
      }
      // Anyone on the file's route (a manager of someone, the approver, the claims
      // manager) reads the lot and keeps what they may see; a patroller only theirs.
      const ctx = {}, t = await team(ctx), me = norm(caller.name);
      const reviewer = !!me && (norm(t.roles.ops) === me || norm(t.roles.claims) === me || t.people.some(p => norm(p.manager) === me));
      const mine = !caller.isAdmin && !reviewer;
      const recs = await fetchRows({ mine, who: caller.name });
      const rows = recs.map(shape).filter(r => { r.access = accessFor(r, caller, t); r.verifier = verifierName(r, t); return r.access.view; });
      // Folder progress for the list — one read of the folder table.
      let all = []; try { all = rows.length ? await folderRows('') : []; } catch (_) { all = []; }
      const by = {}; for (const r of all) { const f = r.fields || {}; (by[f[FF.mvaNo]] = by[f[FF.mvaNo]] || []).push(r); }
      for (const r of rows) { const v = folderView(r, by[r.mvaNo] || []); r.folderDone = v.done; r.folderTotal = v.total; }
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ rows, scope: caller.isAdmin ? 'all' : reviewer ? 'review' : 'mine', items: FOLDER,
        roles: { ops: t.roles.ops, claims: t.roles.claims } });
    }

    const body = L.parseBody(req);

    // Photo upload — the record must exist first, so the form creates the MVA
    // then pushes each photo up.
    if (req.method === 'POST' && body.action === 'upload') {
      if (!body.id || !body.data) return res.status(400).json({ error: 'id and data (base64) are required' });
      if (!(await loadOwned(body.id, caller))) return res.status(404).json(NOT_FOUND);
      await L.uploadAttachment({
        base: BASE, recordId: body.id, fieldId: F.photos,
        filename: body.filename, contentType: body.contentType, data: body.data,
      });
      const rec = await airtable(`${BASE}/${encodeURIComponent(TABLE)}/${encodeURIComponent(body.id)}?returnFieldsByFieldId=true`);
      return res.status(200).json({ row: shape(rec) });
    }

    // ── The accident file folder (patrol/mvas.html) ──────────────────────────
    if (req.method === 'POST' && /^folder/.test(String(body.action || ''))) {
      const row = await loadOwned(body.id, caller);
      if (!row) return res.status(404).json(NOT_FOUND);
      if (!ITEMS.includes(body.item)) return res.status(400).json({ error: 'Unknown folder item' });
      if (!canEdit(row))
        return res.status(409).json({ error: row.access.own ? 'The accident file has been submitted (' + row.stage + ') — it can only be changed if it is sent back to you.'
                                                            : 'Only the patroller builds the folder — send it back with a note if something is missing.' });
      const now = new Date().toISOString();
      const who = { [FF.updatedBy]: caller.name || '', [FF.updatedAt]: now };
      if (body.action === 'folder') {
        const f = Object.assign({}, who);
        if (body.done !== undefined) {
          f[FF.done] = !!body.done;
          f[FF.doneBy] = body.done ? (caller.name || '') : '';
          f[FF.doneAt] = body.done ? now : null;
        }
        if (body.notes !== undefined) f[FF.notes] = String(body.notes).slice(0, 5000);
        await upsertItem(row, body.item, f);
      } else if (body.action === 'folderFile') {
        if (!body.data) return res.status(400).json({ error: 'data (base64) is required' });
        const rec = await upsertItem(row, body.item, who);
        await L.uploadAttachment({ base: BASE, recordId: rec.id, fieldId: FF.files,
          filename: body.filename, contentType: body.contentType, data: body.data });
      } else if (body.action === 'folderFileRemove') {
        const recs = await folderRows(row.mvaNo);
        const hit = recs.find(r => (r.fields || {})[FF.item] === body.item);
        if (!hit) return res.status(404).json({ error: 'File not found' });
        const keep = arr((hit.fields || {})[FF.files]).filter(a => a.id !== body.fileId).map(a => ({ id: a.id }));
        await airtable(`${BASE}/${T_FOLDER}/${hit.id}`, { method: 'PATCH',
          body: JSON.stringify({ returnFieldsByFieldId: true, fields: Object.assign({ [FF.files]: keep }, who) }) });
      } else return res.status(400).json({ error: 'Unknown action' });
      return res.status(200).json({ row, folder: folderView(row, await folderRows(row.mvaNo)), admin: !!caller.isAdmin, photos: await photosFor(row) });
    }

    if (req.method === 'POST') {
      if (!body.date)      return res.status(400).json({ error: 'Date of the MVA is required' });
      if (body.km === '' || body.km == null || isNaN(Number(body.km)))
                           return res.status(400).json({ error: 'KM location is required — it forms part of the MVA number' });
      if (!CHOICES.directions.includes(body.direction))
                           return res.status(400).json({ error: 'Direction is required — it forms part of the MVA number' });
      if (!body.patroller) return res.status(400).json({ error: 'Patroller is required' });
      // A spill is a regulatory call-out, not a checkbox — refuse the report
      // until the patroller confirms Dept. of Environment was notified.
      if (body.spill && !body.doeCalled)
        return res.status(400).json({ error: 'A spill requires the Department of Environment to be called — confirm before submitting.' });

      const mvaNo = await uniqueMvaNo(buildMvaNo(body.date, body.km, body.direction));
      // The patroller's address comes from the Employees directory by name — never
      // from the request. They get the notification too: they build the accident
      // file folder from it (Troy, 2026-10-06).
      const patrollerEmail = await directoryEmail(body.patroller);
      const fields = toFields({ ...body, patrollerEmail, submittedBy: body.submittedBy || caller.name }, mvaNo);
      // ⚠️ returnFieldsByFieldId: shape() reads by field ID. Without it Airtable
      // answers by field NAME, every value reads blank, and the first live MVA
      // (2026-10-06) went out with the subject "MVA" and an empty body.
      const created = await airtable(`${BASE}/${encodeURIComponent(TABLE)}`, {
        // typecast: Lanes Blocked is a single select; it lets a choice listed in
        // CHOICES (e.g. 'Ramp') be added on first use. Every value is already
        // restricted to CHOICES by toFields(), so nothing free-form gets through.
        method: 'POST', body: JSON.stringify({ fields, returnFieldsByFieldId: true, typecast: true }),
      });
      let row = shape(created);

      // Email the distribution list. Best-effort: a mail failure must never lose
      // the notification the patroller just filed.
      // The switch decides who gets it (Patrol Notifications → "MVA notification").
      // Owner test (Troy, 2026-10-06: "for testing this, please disable the send and
      // only send to me"): the Owner gets a [TEST] copy naming who it would have
      // reached; nobody else. Off, a missing row, or a switch that cannot be read:
      // nothing is sent. Everyone: the Accident Group + the patroller.
      const real = recipients(NOTIFY_TO, row.patrollerEmail);
      const subject = `MVA ${row.mvaNo}${flagList(row).length ? ' — ' + flagList(row)[0].replace(/&amp;/g, '&') : ''}`;
      let sw = { id: null, mode: 'Off' };
      try { sw = await C.switchFor(SWITCH); } catch (_) { sw = { id: null, mode: 'Off' }; }
      let sentTo = [], note;
      if (sw.mode === 'Everyone') {
        sentTo = await L.sendMail({ to: real, subject, html: notificationHtml(row) });
        note = sentTo.join(', ');
      } else if (sw.mode === 'Owner test') {
        let to = [];
        try { to = C.owners(await C.directory()); } catch (_) { to = []; }
        if (to.length) sentTo = await L.sendMail({ to, subject: '[TEST] ' + subject, html: testBanner(real) + notificationHtml(row) });
        note = `Owner test — sent to ${sentTo.join(', ') || 'nobody'}; would have gone to ${real.join(', ')}`;
      } else {
        note = `Off — not sent; would have gone to ${real.join(', ')}`;
      }
      await C.stampSwitch(sw, `${row.mvaNo}: ${note}`).catch(() => {});
      const upd = await airtable(`${BASE}/${encodeURIComponent(TABLE)}/${encodeURIComponent(created.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ returnFieldsByFieldId: true,
          fields: Object.assign({ [F.notified]: note }, sentTo.length ? { [F.notifiedAt]: new Date().toISOString() } : {}) }),
      });
      row = shape(upd);
      return res.status(200).json({ row, emailed: sentTo.length > 0, emailedTo: sentTo, mode: sw.mode });
    }

    if (req.method === 'PATCH') {
      if (!body.id) return res.status(400).json({ error: 'id is required' });
      const ctx = {};
      const own = await loadOwned(body.id, caller, ctx);
      if (!own) return res.status(404).json(NOT_FOUND);
      if (body.step) return step(own, body, caller, ctx, res);
      const f = {};
      // The patroller who filed it can add the DMT work order number; status
      // changes are a supervisor action.
      if (body.dmtWo !== undefined) {
        if (!canEdit(own)) return res.status(409).json({ error: 'The accident file has been submitted — it can only be changed if it is sent back.' });
        f[F.dmtWo] = body.dmtWo;
      }
      if (body.status !== undefined) {
        if (!caller.isAdmin) return res.status(403).json({ error: 'Only supervisors and administrators can change the status.' });
        if (CHOICES.statuses.includes(body.status)) f[F.status] = body.status;
      }
      if (!Object.keys(f).length) return res.status(400).json({ error: 'Nothing to update' });
      const updated = await airtable(`${BASE}/${encodeURIComponent(TABLE)}/${encodeURIComponent(body.id)}`, {
        method: 'PATCH', body: JSON.stringify({ fields: f, returnFieldsByFieldId: true }),
      });
      const out = shape(updated); out.access = own.access; out.verifier = own.verifier;
      return res.status(200).json({ row: out });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('mva error:', e);
    return res.status(e.status && e.status < 500 ? e.status : 500).json({ error: e.message || 'Server error' });
  }
};

// ── The route: submit → verify → approve → filed → paid; send back at any step ──
const T_AR = process.env.MVA_AR_TABLE || 'tblShwnpWGogKaZxG';
const AR = { reportNo: 'fldK8gqs6PfZAXNs9', accident: 'fldZpLjNw1PIiS6Cj', repair: 'fldmEpRePHQOxRBkv',
  licence: 'fld3jQnLxu5n5ggO2', plate: 'fld6VmNkhtBnI9H1K', trailer: 'fldWb06wd1RE8uuiq', insurance: 'fldgtdy42gUHjO4We' };
const isImg = a => /^image\//.test(a.type || '') || /\.(jpe?g|png|webp|heic|gif)$/i.test(a.filename || '');
// Every photo in the file, in one place — "Photos are of the utmost importance for
// claims to be processed quickly with insurance companies" (Troy).
async function photosFor(row) {
  const out = [];
  const add = (src, list) => arr(list).forEach(a => out.push({ source: src, id: a.id, url: a.url, filename: a.filename || '',
    thumb: a.thumbnails?.large?.url || a.thumbnails?.small?.url || a.thumb || '' }));
  add('MVA notification', row.photos);
  try {
    const qs = new URLSearchParams(); qs.set('returnFieldsByFieldId', 'true'); qs.set('maxRecords', '1');
    qs.set('filterByFormula', `{Report No.}='${String(row.mvaNo + '-AR').replace(/'/g, "\\'")}'`);
    const ar = ((await airtable(`${BASE}/${T_AR}?${qs}`)).records || [])[0];
    if (ar) { const f = ar.fields || {};
      add('Accident report — accident', f[AR.accident]); add('Accident report — repairs', f[AR.repair]);
      add('Driver\'s licence', f[AR.licence]); add('Licence plate', f[AR.plate]); add('Trailer plate', f[AR.trailer]); add('Insurance card', f[AR.insurance]); }
  } catch (_) { /* the photos panel is a convenience; never fail the read over it */ }
  for (const r of await folderRows(row.mvaNo)) {
    const f = r.fields || {};
    add('Folder — ' + (f[FF.item] || ''), arr(f[FF.files]).filter(isImg));
  }
  const count = s => out.filter(p => s.test(p.source)).length;
  return { list: out, accident: count(/^(MVA notification|Accident report — accident|Folder — Accident photos)/),
           repair: count(/^(Accident report — repairs|Folder — Photos of the completed repairs)/), total: out.length };
}
const stamp = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Moncton', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(',', '');
const histLine = (row, who, what) => (row.history ? row.history + '\n' : '') + `${stamp()} — ${who || '?'} — ${what}`;
const WORKFLOW_SWITCH = 'MVA file workflow';

async function sendStep(row, to, subject, lead, t) {
  const real = [...new Set(to.filter(Boolean).map(e => e.trim()))];
  const html = stepHtml(row, lead);
  let sw = { id: null, mode: 'Off' };
  try { sw = await C.switchFor(WORKFLOW_SWITCH); } catch (_) { sw = { id: null, mode: 'Off' }; }
  let sent = [];
  if (sw.mode === 'Everyone' && real.length) sent = await L.sendMail({ to: real, subject, html });
  else if (sw.mode === 'Owner test') {
    let owners = []; try { owners = C.owners(await C.directory()); } catch (_) { owners = []; }
    if (owners.length) sent = await L.sendMail({ to: owners, subject: '[TEST] ' + subject, html: stepTestBanner(real) + html });
  }
  await C.stampSwitch(sw, `${row.mvaNo}: ${subject} — ${sw.mode}${real.length ? ' — for ' + real.join(', ') : ''}`).catch(() => {});
  return { mode: sw.mode, to: real, sent };
}
function stepTestBanner(real) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#FAF0DA;border-left:4px solid #B7791F;padding:12px 16px;margin-bottom:12px;max-width:640px">
    <b>Test.</b> The MVA file workflow is set to <b>Owner test</b> in the Road Patrol base (Patrol Notifications), so only you got this.
    It would have gone to: ${esc(real.join(', ') || 'nobody — no address on file')}.</div>`;
}
function stepHtml(row, lead) {
  const where = [row.route, row.km != null ? 'km ' + Number(row.km).toFixed(3) : '', row.direction].filter(Boolean).join(' · ');
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:640px">
  <div style="background:#1E2B5E;color:#fff;padding:16px 20px;border-bottom:3px solid #C9A84C">
    <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.65)">MRDC Road Patrol · Accident file</div>
    <div style="font-size:20px;font-weight:600;margin-top:2px">${esc(row.mvaNo)}</div></div>
  <p style="margin:16px 0 8px">${lead}</p>
  <p style="margin:0;color:#6B6B6B">${esc(where)}${row.patroller ? ' · ' + esc(row.patroller) : ''}</p>
  <p style="margin-top:16px"><a href="${esc(APP_URL)}mvas.html?id=${encodeURIComponent(row.id)}" style="color:#15616D;font-weight:600">Open the accident file</a></p>
</div>`;
}

async function step(row, body, caller, ctx, res) {
  const t = await team(ctx), a = row.access, now = new Date().toISOString(), who = caller.name || '';
  const go = async (fields) => {
    const upd = await airtable(`${BASE}/${encodeURIComponent(TABLE)}/${encodeURIComponent(row.id)}`, {
      method: 'PATCH', body: JSON.stringify({ returnFieldsByFieldId: true, fields }) });
    const out = shape(upd); out.access = accessFor(out, caller, t); out.verifier = verifierName(out, t);
    return out;
  };
  const deny = (m) => res.status(403).json({ error: m });
  const wrong = (m) => res.status(409).json({ error: m, stage: row.stage });
  const stepName = String(body.step);

  if (stepName === 'submit') {
    if (!(a.own || a.admin)) return deny('Only the patroller submits the accident file.');
    if (!EDITABLE.includes(row.stage)) return wrong('It has already been submitted (' + row.stage + ').');
    const v = folderView(row, await folderRows(row.mvaNo));
    const missing = v.items.filter(i => !i.done).map(i => i.item);
    const ph = await photosFor(row);
    if (!ph.accident) missing.push('Photos of the accident and damages (at least one)');
    if (!ph.repair) missing.push('Photos of the completed repairs (at least one)');
    if (missing.length) return res.status(409).json({ error: 'Not ready to submit: ' + missing.join(', '), missing });
    const verifier = verifierName(row, t);
    const out = await go({ [F.stage]: 'Awaiting verification', [F.fileSubBy]: who, [F.fileSubAt]: now, [F.sentBackNote]: '',
      [F.history]: histLine(row, who, 'submitted for verification' + (verifier ? ' by ' + verifier : '')) });
    const mail = await sendStep(out, [t.emailOf(verifier)], `MVA ${out.mvaNo} — accident file to verify`,
      `${esc(who)} has submitted the accident file. It is waiting for <b>${esc(verifier || 'a manager')}</b> to verify it.`, t);
    return res.status(200).json({ row: out, mail });
  }
  if (stepName === 'verify' || stepName === 'approve') {
    const want = stepName === 'verify' ? 'Awaiting verification' : 'Awaiting approval';
    if (row.stage !== want) return wrong('It is not waiting for that (' + row.stage + ').');
    if (stepName === 'verify' && !(a.verifier || a.admin)) return deny('Only ' + (row.verifier || 'the patroller\'s manager') + ' verifies this file.');
    if (stepName === 'approve' && !(a.approver || a.admin)) return deny('Only ' + (t.roles.ops || 'the Operations Manager') + ' approves accident files.');
    const next = stepName === 'verify' ? 'Awaiting approval' : 'With claims';
    const fields = stepName === 'verify' ? { [F.verifiedBy]: who, [F.verifiedAt]: now } : { [F.approvedBy]: who, [F.approvedAt]: now };
    const out = await go(Object.assign(fields, { [F.stage]: next, [F.history]: histLine(row, who, stepName === 'verify' ? 'verified' : 'approved') }));
    const to = stepName === 'verify' ? t.roles.ops : t.roles.claims;
    const mail = await sendStep(out, [t.emailOf(to)], `MVA ${out.mvaNo} — accident file ${stepName === 'verify' ? 'to approve' : 'approved — to file with insurance'}`,
      stepName === 'verify' ? `${esc(who)} has verified the accident file. It is waiting for <b>${esc(to || 'the Operations Manager')}</b> to approve it.`
                            : `${esc(who)} has approved the accident file. <b>${esc(to || 'The Claims Manager')}</b> can now process the claim with the insurance company.`, t);
    return res.status(200).json({ row: out, mail });
  }
  if (stepName === 'sendBack') {
    const note = String(body.note || '').trim();
    if (!note) return res.status(400).json({ error: 'Say what needs fixing — the note goes to the patroller.' });
    const mayAt = { 'Awaiting verification': a.verifier, 'Awaiting approval': a.approver, 'With claims': a.claims, 'Filed with insurance': a.claims };
    if (!(row.stage in mayAt)) return wrong('Only a submitted file can be sent back.');
    if (!(mayAt[row.stage] || a.admin)) return deny('It is not with you (' + row.stage + ').');
    const out = await go({ [F.stage]: 'Sent back', [F.sentBackNote]: note.slice(0, 5000),
      [F.history]: histLine(row, who, 'sent back: ' + note.replace(/\s+/g, ' ').slice(0, 300)) });
    const mail = await sendStep(out, [t.emailOf(row.patroller) || row.patrollerEmail], `MVA ${out.mvaNo} — accident file sent back`,
      `${esc(who)} has sent the accident file back: <b>${esc(note)}</b>`, t);
    return res.status(200).json({ row: out, mail });
  }
  if (stepName === 'filed') {
    if (!(a.claims || a.admin)) return deny('Only ' + (t.roles.claims || 'the Claims Manager') + ' files the claim.');
    if (row.stage !== 'With claims') return wrong('It is not with claims yet (' + row.stage + ').');
    const fl = body.filed || {}, date = String(fl.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'The date it was filed is required' });
    if (!String(fl.insurer || '').trim()) return res.status(400).json({ error: 'The insurance company is required' });
    const out = await go({ [F.stage]: 'Filed with insurance', [F.filedDate]: date, [F.filedInsurer]: String(fl.insurer).trim().slice(0, 200),
      [F.claimNo]: String(fl.claimNo || '').trim().slice(0, 100), [F.filedBy]: who, [F.filedAt]: now,
      [F.history]: histLine(row, who, `filed with ${String(fl.insurer).trim()}${fl.claimNo ? ' (claim ' + String(fl.claimNo).trim() + ')' : ''}`) });
    return res.status(200).json({ row: out });
  }
  if (stepName === 'paid') {
    if (!(a.claims || a.admin)) return deny('Only ' + (t.roles.claims || 'the Claims Manager') + ' records the payment.');
    if (row.stage !== 'Filed with insurance') return wrong('It has not been filed yet (' + row.stage + ').');
    const pd = body.paid || {}, date = String(pd.date || ''), amount = pd.amount === '' || pd.amount == null ? null : Number(pd.amount);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'The date the payment was received is required' });
    if (amount != null && !(amount >= 0)) return res.status(400).json({ error: 'The amount must be a number' });
    const out = await go({ [F.stage]: 'Paid', [F.paidDate]: date, [F.paidAmount]: amount,
      [F.history]: histLine(row, who, 'payment received' + (amount != null ? ' $' + amount.toFixed(2) : '')) });
    return res.status(200).json({ row: out });
  }
  return res.status(400).json({ error: 'Unknown step' });
}

// Shared with api/accident.js (the Accident Report + Proof of Repairs, 2026-10-06):
// the same ownership rule and the same folder rows.
module.exports.lib = { BASE, TABLE, F, FF, FOLDER, ITEMS, NOT_FOUND, STAGES, EDITABLE, shape, ownsMva, loadOwned, canEdit, team, accessFor, folderRows, folderView, upsertItem, photosFor };
