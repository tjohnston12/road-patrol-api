// api/patrol.js — road-patrol-api (Vercel)
//
// Daily patrol reports for the MRDC Road Patrol app (www.mrdc-htra.com/patrol/).
// Base: MRDC-HTRA - Road Patrol (app2m7rkP51kLLpbe), table Patrol Reports.
//
// GET   /api/patrol              -> { rows, scope }  newest first
// GET   /api/patrol?id=<rec>     -> { row }
// GET   /api/patrol?mine=1       -> only the caller's own reports
// GET   /api/patrol?meta=1       -> { choices }
// POST  /api/patrol              -> file a daily patrol report -> { row }
// PATCH /api/patrol { id, ... }  -> supervisor review (status / notes)
//
// STRUCTURE MIRRORS THE LIVE DEVICEMAGIC FORM ("Road Patrol Report", form_id
// 5314604), read from its exported definition on 2026-08-18. The important part
// is that the form is conditional, and the conditions are NOT symmetric:
//
//   Season = Summer -> Division is asked (Eastern / Western / Eastern & Western),
//                      routes are the four summer routes,
//                      precipitation is Fog / Rain / None (single choice).
//   Season = Winter -> Depot is asked (Oromocto / Bagdad / River Glade),
//                      DEPOT decides the route list:
//                        Oromocto Depot      -> Western: Oromocto E/W, Mazerolle,
//                                               Route 7
//                        Bagdad / River Glade-> Eastern: Bagdad E/W, River Glade E/W
//                      precipitation is all six (multiple),
//                      pavement temps are asked (and required),
//                      SNIC ops + travel advisory are asked.
//
//   Intensity / Visibility are only asked when precipitation is something other
//   than None. Routes Affected is winter-only, drawn from the routes patrolled.
//
// Deliberate improvement on the DeviceMagic form: it leaves "Winter Routes -
// Western Division" not-required while requiring the Eastern one, which looks
// like an oversight. Here at least one route is required either way.
//
// Env: AIRTABLE_PAT (read+write on the Road Patrol base, read on Employees),
//      AIRTABLE_BASE, PATROL_TABLE.

const L = require('./_lib');

const BASE  = process.env.AIRTABLE_BASE || 'app2m7rkP51kLLpbe';
const TABLE = process.env.PATROL_TABLE  || 'tblosu2dzKTwhuHnf';
const LIMIT = Number(process.env.PATROL_LIMIT || 500);

const F = {
  reportId:       'fldZ4JDUx4Tqc3eQ2', // primary
  shiftDate:      'fldjJZKRSkgEvcR1O',
  season:         'fldbG2jazLXbVSxNC',
  shift:          'fldcNyZwC9MmebOz7',
  patroller:      'fld2yQSx8QJ3Netq3',
  patrollerEmail: 'fldPhRKJLHCyUyhRD',
  division:       'fldxSnElZ4qJ6baHr', // summer only
  depot:          'fld3gAxGzV1VTSDWn', // winter only
  vehicle:        'fldRAvwQ4q1rQQnRy',
  shiftStart:     'fldQvA6fxrGMzQX3F',
  shiftEnd:       'fld3evTcidYDyquje',
  routes:         'fldnh3pvj0twZu5Fe',
  startAir:       'fldC9mQmdJ0xOWJ1j',
  startPavement:  'fldi0girO56WKd3ZF',
  endAir:         'fldUekPGIkjego5QA',
  endPavement:    'fld71zzSHfKCwO1qx',
  precipitation:  'fldjYJYEfIDqOUIVJ',
  intensity:      'fldl9ebCBGw8ywjqS',
  visibility:     'fldndoz491vcQYY5a',
  routesAffected: 'fldv3Eh13Bn5ep2hr',
  snic:           'fldjbHCvkAGktiUUE',
  deficiencies:   'fldMXKeXvFRjqbknW',
  advisory:       'fldMFMIEoY5Zf6fNJ',
  illumination:   'fldtBUHrNfrNPPRH3',
  markings:       'fldgLY0djjNO5CffH',
  reflectivity:   'fldpKan2QFOMO1lZ5',
  etStickers:     'fldkndqr7EZk8OwXN',
  comments:       'fldNiSGurmSRpDwG2',
  status:         'fldn1x0NeaoDQrlcq',
  lastSavedAt:    'fldUBYVR0XrU6WObV',
  emailedTo:      'fldcj4m2XfLUPBuy2',
  emailedAt:      'fldZA2EYznl7FBkBl',
  reviewedBy:     'fldVYyoqFkAA8EKsV',
  reviewedAt:     'flddz3qZXwaWn1I4D',
  reviewNotes:    'fldyDEyQdJZKshvvZ',
  source:         'fldfBSTkvlE3RxUHN',
  submittedBy:    'fldfxE6AIHQIyhJvY',
  submittedAt:    'fldTQy3UXRJoOnbCN',
  shiftHours:     'fldwAxF512NrUYdnQ', // formula (read-only)
};

// ─── Pick-lists. Edit HERE to change what the form offers everywhere. ──────
const SUMMER_ROUTES = ['Oromocto East', 'Oromocto West', 'River Glade East', 'River Glade West'];
// Burton Subdivision was REMOVED 2026-09-02. Troy: "Burton subdivision was a
// contract for a short period, not OMM" — it is not MRDC's to patrol, so offering
// it invited a patroller to record work against a route outside the agreement.
// No stored report ever used it (all 12 rows checked before removing).
// Mazerolle stays: it is a plow route Oromocto's patrollers cover. Note that
// Mazerolle is ALSO a depot in the Employees directory — a vehicle and storage
// depot with plow operators and NO patrollers, which is why it is absent from the
// depot list here. Two meanings, one word; do not "fix" one into the other.
const WINTER_WESTERN = ['Oromocto East', 'Oromocto West', 'Mazerolle', 'Route 7'];
const WINTER_EASTERN = ['Bagdad East', 'Bagdad West', 'River Glade East', 'River Glade West'];
const ALL_ROUTES = [...new Set([...SUMMER_ROUTES, ...WINTER_WESTERN, ...WINTER_EASTERN])];

const SUMMER_PRECIP = ['None', 'Fog', 'Rain'];
const WINTER_PRECIP = ['None', 'Fog', 'Rain', 'Freezing Rain', 'Snow', 'Blowing / Drifting Snow'];

// ─── Rosters come from the Employees directory, by job title ──────────────
// Troy, 2026-08-18: drive these from the directory rather than a hard-coded
// list, so they maintain themselves.
//
// The wrinkle: WINTER PATROLLERS ARE SEASONAL and are marked Inactive in the
// directory out of season. Filtering the winter roster to active employees
// would hide exactly the people it is for — so inactive staff are kept for the
// winter roster, and only there. Summer stays active-only.
const SUMMER_TITLES = ['Patroller - Full Time'];
const WINTER_TITLES = ['Patroller - Full Time', 'Winter Patroller'];

// ─── Where a finished report is emailed ───────────────────────────────────
// The DeviceMagic form did this with a calculated "Mail To" field. The mailbox
// follows the patch being patrolled, not the person:
//   Western division / Oromocto Depot -> oromocto@mrdc.ca
//   Bagdad Depot                      -> oromocto2@mrdc.ca
//   Eastern division / River Glade    -> riverglade@mrdc.ca
// A summer "Eastern & Western" report goes to both division mailboxes.
const MAILBOX = {
  west:      process.env.PATROL_MAIL_WEST      || 'oromocto@mrdc.ca',
  bagdad:    process.env.PATROL_MAIL_BAGDAD    || 'oromocto2@mrdc.ca',
  east:      process.env.PATROL_MAIL_EAST      || 'riverglade@mrdc.ca',
};
function mailboxesFor(row) {
  if (row.season === 'Winter') {
    if (row.depot === 'Oromocto')    return [MAILBOX.west];
    if (row.depot === 'Bagdad')      return [MAILBOX.bagdad];
    if (row.depot === 'River Glade') return [MAILBOX.east];
    return [];
  }
  if (row.division === 'Western')           return [MAILBOX.west];
  if (row.division === 'Eastern')           return [MAILBOX.east];
  if (row.division === 'Eastern & Western') return [MAILBOX.west, MAILBOX.east];
  return [];
}

const CHOICES = {
  seasons:         ['Summer', 'Winter'],
  shifts:          ['Day', 'Night'],
  divisions:       ['Eastern', 'Western', 'Eastern & Western'],
  depots:          ['Oromocto', 'Bagdad', 'River Glade'],
  summerRoutes:    SUMMER_ROUTES,
  winterWestern:   WINTER_WESTERN,
  winterEastern:   WINTER_EASTERN,
  routes:          ALL_ROUTES,
  summerPrecip:    SUMMER_PRECIP,
  winterPrecip:    WINTER_PRECIP,
  intensity:       ['Light', 'Moderate', 'Heavy'],
  visibility:      ['Good', 'Poor', 'Very Poor'],
  statuses:        ['In progress', 'Submitted', 'Reviewed', 'Flagged'],
  reviewStatuses:  ['Submitted', 'Reviewed', 'Flagged'],
};

// The one rule worth having in a function: which routes are valid for a report.
// Winter keys off the DEPOT, not the division — Oromocto Depot runs the western
// routes, Bagdad and River Glade the eastern ones.
function routesFor(season, depot) {
  if (season === 'Summer') return SUMMER_ROUTES;
  return depot === 'Oromocto' ? WINTER_WESTERN : WINTER_EASTERN;
}
const precipFor = season => (season === 'Summer' ? SUMMER_PRECIP : WINTER_PRECIP);

const { arr, sel, num, airtable } = L;

// NOTE: shape() reads fields BY FIELD ID, so every Airtable call feeding it must
// ask for field-ID keys — and the two halves of the API want it in DIFFERENT
// PLACES: reads take returnFieldsByFieldId as a QUERY STRING param, writes take
// it as a BODY param. Passing it in the query string on a PATCH is silently
// ignored, which is exactly the trap this code fell into. Without it Airtable
// answers keyed by field name, every lookup here returns undefined, and the row
// comes back hollow: blank Report ID, blank Season. That is what silently broke
// the report email on 2026-08-18 (a Winter report with season:'' fell through to
// the Summer branch and found no division, so no mailbox resolved).
function shape(rec) {
  const f = rec.fields || {};
  return {
    id:             rec.id,
    reportId:       f[F.reportId] || '',
    shiftDate:      f[F.shiftDate] || '',
    season:         sel(f[F.season]),
    shift:          sel(f[F.shift]),
    patroller:      f[F.patroller] || '',
    patrollerEmail: f[F.patrollerEmail] || '',
    division:       sel(f[F.division]),
    depot:          sel(f[F.depot]),
    vehicle:        f[F.vehicle] || '',
    shiftStart:     f[F.shiftStart] || '',
    shiftEnd:       f[F.shiftEnd] || '',
    shiftHours:     f[F.shiftHours] != null ? f[F.shiftHours] : null,
    routes:         arr(f[F.routes]).map(sel),
    startAir:       f[F.startAir] != null ? f[F.startAir] : null,
    startPavement:  f[F.startPavement] != null ? f[F.startPavement] : null,
    endAir:         f[F.endAir] != null ? f[F.endAir] : null,
    endPavement:    f[F.endPavement] != null ? f[F.endPavement] : null,
    precipitation:  arr(f[F.precipitation]).map(sel),
    intensity:      sel(f[F.intensity]),
    visibility:     sel(f[F.visibility]),
    routesAffected: arr(f[F.routesAffected]).map(sel),
    snic:           !!f[F.snic],
    deficiencies:   !!f[F.deficiencies],
    advisory:       !!f[F.advisory],
    illumination:   !!f[F.illumination],
    markings:       !!f[F.markings],
    reflectivity:   !!f[F.reflectivity],
    etStickers:     !!f[F.etStickers],
    comments:       f[F.comments] || '',
    status:         sel(f[F.status]) || 'Submitted',
    lastSavedAt:    f[F.lastSavedAt] || '',
    emailedTo:      f[F.emailedTo] || '',
    emailedAt:      f[F.emailedAt] || '',
    reviewedBy:     f[F.reviewedBy] || '',
    reviewedAt:     f[F.reviewedAt] || '',
    reviewNotes:    f[F.reviewNotes] || '',
    source:         sel(f[F.source]) || 'Road Patrol app',
    submittedBy:    f[F.submittedBy] || '',
    submittedAt:    f[F.submittedAt] || '',
    createdTime:    rec.createdTime,
  };
}

function toFields(b) {
  const f = {};
  const winter = b.season === 'Winter';
  const pick = (list, v) => (list.includes(v) ? v : undefined);
  const pickMany = (list, vs) => arr(vs).filter(v => list.includes(v));
  const set = (k, v) => { if (v !== undefined && v !== '') f[k] = v; };
  const n = (k, v) => { const x = num(v); if (x !== undefined) f[k] = x; };

  set(F.reportId,       b.reportId);
  set(F.shiftDate,      b.shiftDate);
  set(F.season,         pick(CHOICES.seasons, b.season));
  set(F.shift,          pick(CHOICES.shifts,  b.shift));
  set(F.patroller,      b.patroller);
  set(F.patrollerEmail, b.patrollerEmail);
  set(F.vehicle,        b.vehicle);
  set(F.shiftStart,     b.shiftStart);
  set(F.shiftEnd,       b.shiftEnd);
  set(F.comments,       b.comments);
  set(F.submittedBy,    b.submittedBy);

  // Division is a summer field, Depot a winter one — never write the other, so
  // a season change on the form cannot leave a stale value behind.
  if (winter) set(F.depot,    pick(CHOICES.depots,    b.depot));
  else        set(F.division, pick(CHOICES.divisions, b.division));

  const validRoutes = routesFor(b.season, b.depot);
  if (b.routes !== undefined) f[F.routes] = pickMany(validRoutes, b.routes);
  // Routes Affected is winter-only on the DeviceMagic form, and only makes
  // sense for routes actually patrolled.
  if (winter && b.routesAffected !== undefined) {
    const patrolled = pickMany(validRoutes, b.routes);
    f[F.routesAffected] = arr(b.routesAffected).filter(r => patrolled.includes(r));
  }

  if (b.precipitation !== undefined) f[F.precipitation] = pickMany(precipFor(b.season), b.precipitation);
  // Intensity and visibility only apply when there is actual precipitation.
  const realPrecip = pickMany(precipFor(b.season), b.precipitation).filter(p => p !== 'None');
  if (realPrecip.length) {
    set(F.intensity,  pick(CHOICES.intensity,  b.intensity));
    set(F.visibility, pick(CHOICES.visibility, b.visibility));
  }

  n(F.startAir, b.startAir);
  n(F.endAir,   b.endAir);
  if (winter) { n(F.startPavement, b.startPavement); n(F.endPavement, b.endPavement); }

  // Checkboxes are written whenever the client sent a value for them, so an
  // unticked box records a real "no" — but a partial draft save that omits them
  // must not silently set every check to "no".
  const cb = (k, v) => { if (v !== undefined) f[k] = !!v; };
  cb(F.deficiencies, b.deficiencies);
  cb(F.illumination, b.illumination);
  cb(F.markings,     b.markings);
  cb(F.reflectivity, b.reflectivity);
  cb(F.etStickers,   b.etStickers);
  // SNIC ops and travel advisory are winter questions.
  if (winter) { cb(F.snic, b.snic); cb(F.advisory, b.advisory); }

  f[F.source]      = 'Road Patrol app';
  f[F.lastSavedAt] = new Date().toISOString();
  return f;
}

async function getChoices() {
  const [employees, vehicles] = await Promise.all([L.getEmployees(), getVehicles()]);
  const named = t => employees.filter(e => e.titles.some(x => t.includes(x)));
  // Summer: active only. Winter: keep inactive seasonal staff (see WINTER_TITLES).
  const summerPatrollers = named(SUMMER_TITLES).filter(e => e.active);
  const winterPatrollers = named(WINTER_TITLES);
  const slim = e => ({ name: e.name, email: e.email, depot: e.depot, active: e.active });
  return {
    ...CHOICES,
    summerPatrollers: summerPatrollers.map(slim),
    winterPatrollers: winterPatrollers.map(slim),
    // Every active employee, so "someone else" can still be resolved to an email.
    patrollers: employees.filter(e => e.active).map(slim),
    vehicles,
  };
}

async function getVehicles() {
  try {
    const qs = new URLSearchParams();
    qs.set('pageSize', '100');
    qs.set('returnFieldsByFieldId', 'true');
    qs.append('fields[]', F.vehicle);
    qs.set('sort[0][field]', F.shiftDate);
    qs.set('sort[0][direction]', 'desc');
    const page = await airtable(`${BASE}/${encodeURIComponent(TABLE)}?${qs}`);
    const set = new Set();
    for (const rec of (page.records || [])) {
      const v = String(rec.fields?.[F.vehicle] || '').trim();
      if (v) set.add(v);
    }
    return [...set].sort();
  } catch (_) { return []; }
}

async function fetchRows({ mine, who }) {
  const rows = [];
  let offset;
  do {
    const qs = new URLSearchParams();
    qs.set('pageSize', '100');
    qs.set('returnFieldsByFieldId', 'true');
    qs.set('sort[0][field]', F.shiftDate);
    qs.set('sort[0][direction]', 'desc');
    if (mine && who) {
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

async function findByReportId(reportId) {
  if (!reportId) return null;
  const qs = new URLSearchParams();
  qs.set('maxRecords', '1');
  qs.set('returnFieldsByFieldId', 'true');
  qs.set('filterByFormula', `{Report ID}='${String(reportId).replace(/'/g, "\\'")}'`);
  const j = await airtable(`${BASE}/${encodeURIComponent(TABLE)}?${qs}`);
  return (j.records || [])[0] || null;
}

// Has this patroller already filed for this date + shift? Used to warn on a
// likely duplicate without blocking a genuine second report.
async function findSameShift({ patroller, shiftDate, shift }) {
  if (!patroller || !shiftDate) return null;
  const qs = new URLSearchParams();
  qs.set('maxRecords', '1');
  qs.set('returnFieldsByFieldId', 'true');
  const safe = String(patroller).toLowerCase().replace(/'/g, "\\'");
  qs.set('filterByFormula',
    `AND(LOWER({Patroller}&'')='${safe}',DATETIME_FORMAT({Shift Date},'YYYY-MM-DD')='${shiftDate}'` +
    (shift ? `,{Shift}='${String(shift).replace(/'/g, "\\'")}'` : '') + ')');
  const j = await airtable(`${BASE}/${encodeURIComponent(TABLE)}?${qs}`);
  return (j.records || [])[0] || null;
}

// ─── The finished report, as an email ─────────────────────────────────────
// Sent on final submit to the depot/division mailbox, plus the patroller's own
// if they asked for a copy. Best-effort: a mail failure must never undo a
// submitted report, so it is reported back but never thrown.
function reportHtml(row) {
  const e = L.esc;
  const yn = v => (v ? 'Yes' : 'No');
  const t  = v => (v ? String(v).replace('T', ' ').slice(0, 16) : '—');
  const winter = row.season === 'Winter';

  const rows = [
    ['Patroller',    row.patroller],
    ['Season',       row.season + (row.shift ? ' · ' + row.shift + ' shift' : '')],
    [winter ? 'Depot' : 'Division', winter ? row.depot : row.division],
    ['Patrol vehicle', row.vehicle],
    ['Shift start',  t(row.shiftStart)],
    ['Shift end',    t(row.shiftEnd)],
    ['Shift length', row.shiftHours != null ? row.shiftHours + ' hours' : '—'],
    ['Routes patrolled', (row.routes || []).join(', ')],
    ['Air temp',     [row.startAir, row.endAir].filter(v => v != null).join(' → ') || '—'],
  ];
  if (winter) rows.push(['Pavement temp',
    [row.startPavement, row.endPavement].filter(v => v != null).join(' → ') || '—']);
  rows.push(['Precipitation', (row.precipitation || []).join(', ') || '—']);
  if ((row.precipitation || []).some(p => p !== 'None')) {
    rows.push(['Intensity', row.intensity || '—'], ['Visibility', row.visibility || '—']);
    if ((row.routesAffected || []).length) rows.push(['Routes affected', row.routesAffected.join(', ')]);
  }

  const checks = [
    ['OMM deficiencies entered', row.deficiencies],
    ...(winter ? [['SNIC ops deployed', row.snic], ['Travel advisory issued / lifted', row.advisory]] : []),
    ['Highway illumination inspection', row.illumination],
    ['Pavement markings checked', row.markings],
    ['Road sign reflectivity checked', row.reflectivity],
    ['ET stickers & reflectors checked', row.etStickers],
  ];

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:640px">
  <div style="background:#1E2B5E;color:#fff;padding:16px 20px;border-bottom:3px solid #C9A84C">
    <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.65)">MRDC Road Patrol</div>
    <div style="font-size:20px;font-weight:600;margin-top:2px">Daily Patrol Report — ${e(row.shiftDate)}</div>
  </div>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    ${rows.map(([k, v]) => `<tr><td style="padding:7px 0;color:#6B6B6B;width:180px;vertical-align:top">${e(k)}</td>
      <td style="padding:7px 0;font-weight:500">${e(v || '—')}</td></tr>`).join('')}
  </table>
  <div style="font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#15616D;margin:18px 0 6px">Shift checks</div>
  <table style="width:100%;border-collapse:collapse">
    ${checks.map(([k, v]) => `<tr><td style="padding:6px 0;border-bottom:1px solid #f2f1ee">${e(k)}</td>
      <td style="padding:6px 0;border-bottom:1px solid #f2f1ee;text-align:right;font-weight:600;color:${v ? '#0F6E56' : '#6B6B6B'}">${yn(v)}</td></tr>`).join('')}
  </table>
  ${row.comments ? `<div style="font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#15616D;margin:18px 0 6px">Comments</div>
    <div style="background:#f7f7f5;border:1px solid #DDD9D0;border-radius:8px;padding:11px 13px;white-space:pre-wrap">${e(row.comments)}</div>` : ''}
  <p style="margin-top:18px;font-size:12px;color:#6B6B6B">Report ${e(row.reportId)} · filed by ${e(row.submittedBy || row.patroller)} via the MRDC Road Patrol app.</p>
</div>`;
}

// Email a submitted report and stamp where it went. Returns the recipient list.
async function emailReport(row, { copyToPatroller } = {}) {
  const to = mailboxesFor(row);
  if (copyToPatroller && row.patrollerEmail && !to.includes(row.patrollerEmail)) to.push(row.patrollerEmail);
  if (!to.length) {
    const where = row.season === 'Winter' ? `depot "${row.depot}"` : `division "${row.division}"`;
    return { sent: [], reason: `no mailbox is configured for ${where}` };
  }
  const winter = row.season === 'Winter';
  const where = winter ? row.depot : row.division;
  return L.sendMailDetailed({
    to,
    subject: `Patrol report ${row.shiftDate}${where ? ' — ' + where : ''}${row.shift ? ' (' + row.shift + ')' : ''} — ${row.patroller}`,
    html: reportHtml(row),
    from: process.env.PATROL_FROM,
  });
}

// The caller's currently-open shift report, newest first. There should only be
// one, but if a stale draft is lying around we hand back the most recent.
async function findOpenReport(who) {
  if (!who) return null;
  const qs = new URLSearchParams();
  qs.set('maxRecords', '1');
  qs.set('returnFieldsByFieldId', 'true');
  qs.set('sort[0][field]', F.lastSavedAt);
  qs.set('sort[0][direction]', 'desc');
  const safe = String(who).toLowerCase().replace(/'/g, "\\'");
  qs.set('filterByFormula',
    `AND({Status}='In progress',OR(LOWER({Submitted By}&'')='${safe}',LOWER({Patroller}&'')='${safe}'))`);
  const j = await airtable(`${BASE}/${encodeURIComponent(TABLE)}?${qs}`);
  return (j.records || [])[0] || null;
}

// A patroller owns a report while it is theirs and still in progress. Ownership
// is by name, which is as strong as the x-user-* headers allow — the same
// caveat that applies everywhere in this API.
function ownsRow(req, rec) {
  const f = rec.fields || {};
  const me = L.callerName(req).trim().toLowerCase();
  if (!me) return false;
  return String(f[F.submittedBy] || '').trim().toLowerCase() === me ||
         String(f[F.patroller]   || '').trim().toLowerCase() === me;
}

// Everything a completed report must have. Returns the first problem, or null.
// Used on final submit only — a draft is allowed to be as empty as it likes.
function validateComplete(b) {
  if (!b.shiftDate) return 'Shift date is required';
  if (!CHOICES.seasons.includes(b.season)) return 'Season is required';
  if (!b.patroller) return 'Patroller is required';
  if (b.season === 'Winter' && !CHOICES.depots.includes(b.depot)) return 'Depot is required on a winter report';
  if (b.season === 'Summer' && !CHOICES.divisions.includes(b.division)) return 'Division is required on a summer report';
  if (!String(b.vehicle || '').trim()) return 'Patrol vehicle # is required';
  if (!b.shiftStart || !b.shiftEnd) return 'Shift start and end are required';
  const validRoutes = routesFor(b.season, b.depot);
  if (!arr(b.routes).filter(r => validRoutes.includes(r)).length) return 'At least one route patrolled is required';
  if (!arr(b.precipitation).length) return 'Precipitation is required (choose None if there was none)';
  if (b.season === 'Winter') {
    if (num(b.startPavement) === undefined) return 'Start pavement temperature is required in winter';
    if (num(b.endPavement) === undefined) return 'End pavement temperature is required in winter';
  }
  if (!String(b.comments || '').trim()) return 'Description / comments are required';
  return null;
}

module.exports = async function handler(req, res) {
  if (L.cors(req, res)) return;
  if (!L.PAT) return res.status(500).json({ error: 'Server not configured (AIRTABLE_PAT missing)' });

  try {
    if (req.method === 'GET') {
      if (String(req.query?.meta || '') === '1') {
        return res.status(200).json({ choices: await getChoices() });
      }
      const id = req.query?.id;
      if (id) {
        const rec = await airtable(`${BASE}/${encodeURIComponent(TABLE)}/${encodeURIComponent(id)}?returnFieldsByFieldId=true`);
        return res.status(200).json({ row: shape(rec) });
      }
      // The caller's currently-open shift report, so the app can offer to resume
      // it instead of starting a second one.
      if (String(req.query?.open || '') === '1') {
        const rec = await findOpenReport(L.callerName(req));
        return res.status(200).json({ row: rec ? shape(rec) : null });
      }
      if (req.query?.check === 'shift') {
        const dup = await findSameShift({
          patroller: req.query.patroller, shiftDate: req.query.shiftDate, shift: req.query.shift,
        });
        return res.status(200).json({ exists: !!dup, row: dup ? shape(dup) : null });
      }
      const mine = String(req.query?.mine || '') === '1' || !L.isAdmin(req);
      const recs = await fetchRows({ mine, who: L.callerName(req) });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ rows: recs.map(shape), scope: mine ? 'mine' : 'all' });
    }

    const body = L.parseBody(req);

    // ── POST: open a new report ──────────────────────────────────────────
    // draft:true starts a shift report the patroller keeps open and fills in as
    // the day goes on. It is validated only at final submit.
    if (req.method === 'POST') {
      const isDraft = body.draft === true;

      if (!isDraft) {
        const problem = validateComplete(body);
        if (problem) return res.status(400).json({ error: problem });
      } else if (!body.patroller && !L.callerName(req)) {
        return res.status(400).json({ error: 'Patroller is required' });
      }

      const existing = await findByReportId(body.reportId);
      if (existing) return res.status(200).json({ row: shape(existing), duplicate: true });

      const fields = toFields({ ...body, submittedBy: body.submittedBy || L.callerName(req) });
      fields[F.status] = isDraft ? 'In progress' : 'Submitted';
      if (!isDraft) fields[F.submittedAt] = new Date().toISOString();
      const created = await airtable(`${BASE}/${encodeURIComponent(TABLE)}`, {
        method: 'POST', body: JSON.stringify({ fields, returnFieldsByFieldId: true }),
      });
      let row = shape(created), emailNote = '';
      if (!isDraft) ({ row, emailNote } = await deliver(created.id, row, body.copyToMe === true));
      return res.status(200).json({
        row, emailNote,
        emailedTo: row.emailedTo ? row.emailedTo.split(', ') : [],
      });
    }

    // ── PATCH: save a draft, submit it, or review it ─────────────────────
    if (req.method === 'PATCH') {
      if (!body.id) return res.status(400).json({ error: 'id is required' });
      const rec = await airtable(`${BASE}/${encodeURIComponent(TABLE)}/${encodeURIComponent(body.id)}?returnFieldsByFieldId=true`);
      const current = sel(rec.fields?.[F.status]) || 'Submitted';

      // Supervisor review — status/notes on an already-submitted report.
      if (body.review === true) {
        if (!L.isAdmin(req)) return res.status(403).json({ error: 'Only supervisors and administrators can review reports.' });
        const f = { [F.reviewedBy]: L.callerName(req), [F.reviewedAt]: new Date().toISOString() };
        if (CHOICES.reviewStatuses.includes(body.status)) f[F.status] = body.status;
        if (body.reviewNotes !== undefined) f[F.reviewNotes] = body.reviewNotes;
        const updated = await airtable(`${BASE}/${encodeURIComponent(TABLE)}/${encodeURIComponent(body.id)}`, {
          method: 'PATCH', body: JSON.stringify({ fields: f, returnFieldsByFieldId: true }),
        });
        return res.status(200).json({ row: shape(updated) });
      }

      // Otherwise this is the patroller working on their own open report.
      if (current !== 'In progress')
        return res.status(409).json({ error: 'This report has already been submitted and can no longer be edited.' });
      if (!ownsRow(req, rec) && !L.isAdmin(req))
        return res.status(403).json({ error: 'This report belongs to another patroller.' });

      const submitting = body.submit === true;
      if (submitting) {
        // Validate the merged picture: what is already stored, overlaid with
        // whatever this final save is sending.
        const merged = { ...shape(rec), ...stripUndefined(body) };
        const problem = validateComplete(merged);
        if (problem) return res.status(400).json({ error: problem });
      }

      const fields = toFields({ ...body, submittedBy: rec.fields?.[F.submittedBy] || L.callerName(req) });
      if (submitting) {
        fields[F.status] = 'Submitted';
        fields[F.submittedAt] = new Date().toISOString();
      }
      const updated = await airtable(`${BASE}/${encodeURIComponent(TABLE)}/${encodeURIComponent(body.id)}`, {
        method: 'PATCH', body: JSON.stringify({ fields, returnFieldsByFieldId: true }),
      });
      let row = shape(updated), emailNote = '';
      if (submitting) ({ row, emailNote } = await deliver(body.id, row, body.copyToMe === true));
      return res.status(200).json({
        row, emailNote,
        emailedTo: row.emailedTo ? row.emailedTo.split(', ') : [],
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('patrol error:', e);
    return res.status(e.status && e.status < 500 ? e.status : 500).json({ error: e.message || 'Server error' });
  }
};

// Send the report and record where it went. Never throws — the report is
// already safely filed by the time this runs.
async function deliver(id, row, copyToPatroller) {
  try {
    const { sent, reason } = await emailReport(row, { copyToPatroller });
    if (!sent.length) return { row, emailNote: reason || 'nothing was sent' };
    const upd = await airtable(`${BASE}/${encodeURIComponent(TABLE)}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        fields: { [F.emailedTo]: sent.join(', '), [F.emailedAt]: new Date().toISOString() },
        returnFieldsByFieldId: true,
      }),
    });
    return { row: shape(upd), emailNote: '' };
  } catch (e) {
    console.error('report email failed:', e.message);
    return { row, emailNote: `report email threw: ${e.message}` };
  }
}

function stripUndefined(o) {
  const out = {};
  Object.keys(o || {}).forEach(k => { if (o[k] !== undefined && o[k] !== '') out[k] = o[k]; });
  return out;
}

// Exposed for _tests/test-patrol-choices.js. The pick-lists ARE the contract the
// form renders from — the page holds no route list of its own — so they are worth
// asserting directly and not only through a browser.
// NOTE: this must come AFTER the `module.exports = handler` assignment above, or
// that assignment replaces the whole exports object and takes __test with it.
module.exports.__test = {
  SUMMER_ROUTES, WINTER_WESTERN, WINTER_EASTERN, ALL_ROUTES,
  SUMMER_PRECIP, WINTER_PRECIP, CHOICES, routesFor, precipFor,
};
