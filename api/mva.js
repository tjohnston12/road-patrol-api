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

const BASE  = process.env.MVA_BASE  || 'appMKaiabPAPx3JaV';
const TABLE = process.env.MVA_TABLE || 'tblFnoVfyA9nSEOwk';
const LIMIT = Number(process.env.MVA_LIMIT || 400);
const APP_URL = process.env.PATROL_APP_URL || 'https://www.mrdc-htra.com/patrol/';

// Where the MVA notification goes. "Accident Group" is the existing MRDC
// distribution list; MVA_NOTIFY_TO overrides it (comma-separated) without a
// code change. NOTE for deploy: the group must accept mail from the Resend
// sender domain, or Microsoft 365 will reject it as an external sender.
const NOTIFY_TO = process.env.MVA_NOTIFY_TO || 'AccidentGroup2@mrdc.ca';

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
};

const CHOICES = {
  divisions:  ['Eastern', 'Western'],
  routes:     ['Route 2', 'Route 7', 'Other'],
  directions: ['EB', 'WB', 'NB', 'SB'],
  services:   ['Police (RCMP)', 'Ambulance', 'Fire', 'Dept. of Environment', 'Tow', 'DTI', 'None'],
  lanes:      ['Shoulder only', 'One lane', 'Both lanes', 'Full closure'],
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
  <p style="margin-top:18px;font-size:13px"><a href="${esc(APP_URL)}" style="color:#15616D">Open the Road Patrol app</a></p>
  <p style="margin-top:14px;font-size:12px;color:#6B6B6B">Filed by ${esc(row.submittedBy || row.patroller)} via the MRDC Road Patrol app.</p>
</div>`;
}

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
        const rec = await airtable(`${BASE}/${encodeURIComponent(TABLE)}/${encodeURIComponent(id)}?returnFieldsByFieldId=true`);
        return res.status(200).json({ row: shape(rec) });
      }
      const mine = String(req.query?.mine || '') === '1' || !caller.isAdmin;
      const recs = await fetchRows({ mine, who: caller.name });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ rows: recs.map(shape), scope: mine ? 'mine' : 'all' });
    }

    const body = L.parseBody(req);

    // Photo upload — the record must exist first, so the form creates the MVA
    // then pushes each photo up.
    if (req.method === 'POST' && body.action === 'upload') {
      if (!body.id || !body.data) return res.status(400).json({ error: 'id and data (base64) are required' });
      await L.uploadAttachment({
        base: BASE, recordId: body.id, fieldId: F.photos,
        filename: body.filename, contentType: body.contentType, data: body.data,
      });
      const rec = await airtable(`${BASE}/${encodeURIComponent(TABLE)}/${encodeURIComponent(body.id)}?returnFieldsByFieldId=true`);
      return res.status(200).json({ row: shape(rec) });
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
      const fields = toFields({ ...body, submittedBy: body.submittedBy || caller.name }, mvaNo);
      const created = await airtable(`${BASE}/${encodeURIComponent(TABLE)}`, {
        method: 'POST', body: JSON.stringify({ fields }),
      });
      let row = shape(created);

      // Email the distribution list. Best-effort: a mail failure must never lose
      // the notification the patroller just filed.
      const sentTo = await L.sendMail({
        to: NOTIFY_TO,
        subject: `MVA ${row.mvaNo}${flagList(row).length ? ' — ' + flagList(row)[0].replace(/&amp;/g, '&') : ''}`,
        html: notificationHtml(row),
      });
      if (sentTo.length) {
        const upd = await airtable(`${BASE}/${encodeURIComponent(TABLE)}/${encodeURIComponent(created.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ fields: { [F.notifiedAt]: new Date().toISOString(), [F.notified]: sentTo.join(', ') } }),
        });
        row = shape(upd);
      }
      return res.status(200).json({ row, emailed: sentTo.length > 0, emailedTo: sentTo });
    }

    if (req.method === 'PATCH') {
      if (!body.id) return res.status(400).json({ error: 'id is required' });
      const f = {};
      // The patroller who filed it can add the DMT work order number; status
      // changes are a supervisor action.
      if (body.dmtWo !== undefined) f[F.dmtWo] = body.dmtWo;
      if (body.status !== undefined) {
        if (!caller.isAdmin) return res.status(403).json({ error: 'Only supervisors and administrators can change the status.' });
        if (CHOICES.statuses.includes(body.status)) f[F.status] = body.status;
      }
      if (!Object.keys(f).length) return res.status(400).json({ error: 'Nothing to update' });
      const updated = await airtable(`${BASE}/${encodeURIComponent(TABLE)}/${encodeURIComponent(body.id)}`, {
        method: 'PATCH', body: JSON.stringify({ fields: f }),
      });
      return res.status(200).json({ row: shape(updated) });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('mva error:', e);
    return res.status(e.status && e.status < 500 ? e.status : 500).json({ error: e.message || 'Server error' });
  }
};
