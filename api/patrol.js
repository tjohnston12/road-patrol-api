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
const { requireCaller } = require('./_auth');

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
  // Section 7 of the report — added 2026-09-21.
  defsJson:       'fldivNgQ0BW6Uj6Qd', // "Deficiencies": the working rows, as JSON
  defsRaised:     'fldk2XbHe7J5y7iwU', // "Deficiencies Raised": how many got a work order
  defsWos:        'fldU5hpigJpzZB20V', // "Work Orders Raised": the WO numbers, one per line
};

/* ── deficiencies raised from the shift report ───────────────────────────────
   Troy's numbers: 404 work orders sourced "Road patrol" in 90 days, roughly one
   or two per patroller per shift. Sending a patroller out to the DMT and back
   for each one is four page loads on cellular, so they are raised from inside
   the report and handed on from here.

   ⚠️ THE DMT STAYS THE SYSTEM OF RECORD. Nothing below writes a work order. Each
   row goes to the DMT's /api/intake — the same single write path Device Magic
   and the Quality audits use — and what comes back is a work order number this
   report then carries. The browser never talks to the DMT directly.

   ⚠️ AND A DMT OUTAGE MUST NEVER COST THE REPORT. Every failure here is caught
   and reported as "nothing raised this time"; the rows stay on the report and go
   out on the next save, the next `online`, or at submit. The report is the
   contractual record and it is filed either way. */
const DMT_INTAKE_URL = process.env.DMT_INTAKE_URL || 'https://dmt.mrdc-htra.com/api/intake';
/* The DMT's /api/intake requires a caller since 2026-09-23. This runs server
   side with no cookie, so it presents the DMT's service key. ⚠️ Set
   DMT_INTAKE_SECRET on road-patrol-api to the DMT's INTAKE_SECRET, or every
   roadside deficiency stops reaching the DMT with a 401. */
const DMT_INTAKE_SECRET = (process.env.DMT_INTAKE_SECRET || '').trim();
const DMT_TIMEOUT_MS = Number(process.env.DMT_TIMEOUT_MS || 12000);
const MAX_DEFS = 50;              // a shift that found 50 has a different problem
const MAX_DESC = 2000;
const MAX_PHOTOS = 6;             // per deficiency
/* ⚠️ A photo URL goes onto a contractual work order, so only our own cloud is
   accepted. The browser uploads straight to Cloudinary and sends back what
   Cloudinary returned; anything else in that array is not a photo of a pothole.
   Cloud djrqifos6, preset uzh72cqd — working agreement §8. */
const PHOTO_URL = /^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]+\//;

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
const WINTER_TITLES = ['Patroller - Full Time', 'Patroller - Winter'];

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
/* One deficiency row, as it is allowed to be stored. A whitelist, not a filter:
   this JSON arrives from a browser and lands in a contractual record, so only
   these keys exist and every one of them is bounded. */
function cleanDef(d) {
  if (!d || typeof d !== 'object') return null;
  const str = (v, max) => String(v == null ? '' : v).slice(0, max);
  /* A coordinate outside its own range is not a coordinate. Dropping it leaves
     the work order located by route + km, which is how the depot finds things
     anyway; keeping it would drop a map pin in the wrong hemisphere. */
  const geo = (v, limit) => {
    const n = num(v);
    return (n === undefined || !isFinite(n) || Math.abs(n) > limit) ? undefined : n;
  };
  const seq = Number(d.seq);
  if (!Number.isInteger(seq) || seq < 1 || seq > 9999) return null;
  const out = {
    seq,
    standard:    str(d.standard, 60),
    finding:     str(d.finding, 200),
    route:       str(d.route, 60),
    km:          num(d.km),
    toKm:        num(d.toKm),
    direction:   str(d.direction, 30),
    // The asset register's id for the culvert/sign/guiderail this is about.
    // Intake's lookupAsset() fills type, name, route and km from it, and its
    // duplicate check is keyed on Asset ID + Standard, so an id typed here is
    // what stops the same culvert being raised twice.
    assetId:     str(d.assetId, 60),
    /* The register's name for that asset, as the patroller saw it when they
       picked it. Denormalised so this report reads without a join — the same
       thing Media, Inspections and Asset Messages do — and NOT sent on to
       intake, which resolves the name from the register itself. */
    assetName:   str(d.assetName, 120),
    side:        str(d.side, 30),
    lat:         geo(d.lat, 90),
    lng:         geo(d.lng, 180),
    description: str(d.description, MAX_DESC).trim(),
    wo:          str(d.wo, 40),
    // an open work order the DMT found near this spot when this one was raised
    dup:         str(d.dup, 40),
    photos:      (Array.isArray(d.photos) ? d.photos : [])
                   .map(u => str(u, 400).trim())
                   .filter(u => PHOTO_URL.test(u))
                   .filter((u, i, a) => a.indexOf(u) === i)
                   .slice(0, MAX_PHOTOS),
    // true once the DMT has been given this row's photos, so a row that is
    // already raised is not re-sent on every save for the rest of the shift
    photosSent:  !!d.photosSent,
  };
  if (out.km === undefined) delete out.km;
  if (out.toKm === undefined) delete out.toKm;
  if (out.lat === undefined) delete out.lat;
  if (out.lng === undefined) delete out.lng;
  return out;
}
function cleanDefs(list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  return list.map(cleanDef).filter(d => {
    // The seq is the DMT's idempotency key for this report. Two rows sharing one
    // would be merged into a single work order there, so the duplicate is dropped
    // rather than quietly sent.
    if (!d || seen.has(d.seq)) return false;
    seen.add(d.seq); return true;
  }).slice(0, MAX_DEFS);
}
function parseDefs(raw) {
  if (!raw) return [];
  try { return cleanDefs(JSON.parse(raw)) || []; } catch (_) { return []; }
}
// "RP-20260921-1431-GO39-D03". Derived from the report, so a retry or a
// re-delivery hits intake's existingWO() and returns the same work order rather
// than raising a second one.
const deficiencyId = (reportId, seq) => `${reportId}-D${String(seq).padStart(2, '0')}`;

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
    deficiencyRows:     parseDefs(f[F.defsJson]),   // NOT `deficiencies` — that is the checkbox
    deficienciesRaised: f[F.defsRaised] != null ? f[F.defsRaised] : null,
    workOrdersRaised:   f[F.defsWos] || '',
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
  /* The deficiency rows, and the two human-readable views of them beside it.
     Assigned rather than set(), because an empty list has to be able to CLEAR
     the fields — set() skips '' — and only when the client actually sent the
     key, so a partial draft save that omits it cannot wipe the shift's work.
     Same discipline as the checkboxes below. */
  const defs = cleanDefs(b.deficiencyRows);
  if (defs) {
    f[F.defsJson]   = defs.length ? JSON.stringify(defs) : '';
    f[F.defsRaised] = defs.filter(d => d.wo).length;
    f[F.defsWos]    = defs.map(d => d.wo).filter(Boolean).join('\n');
  }

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
    /* ⚠️ FAILS OPEN IF THIS IS WRITTEN AS `if (mine && who)`. That is what it
       said until 2026-09-23: a caller with no name skipped the filter entirely
       and got EVERY report, while a named non-admin correctly got only their
       own. An anonymous request was the one case that produced the widest
       result. A scope of "mine" with nobody to be must return nothing. */
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
  /* What the shift actually raised. A depot reading this email otherwise has
     "OMM deficiencies entered: Yes" and nothing to look up. */
  if ((row.workOrdersRaised || '').trim()) {
    rows.push(['Work orders raised', (row.workOrdersRaised || '').trim().split('\n').join(', ')]);
  }
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

/* A patroller owns a report while it is theirs and still in progress.
   Ownership is matched by name — but the name now comes from the validated
   session rather than from x-user-name, so it is no longer something the
   caller can simply assert. (Matching on the employee record id would be
   stronger still: names in Airtable are renameable, which §2b of the working
   agreement warns about. That is a data migration on the Patroller and
   Submitted By fields, not part of closing this hole.) */
function ownsRow(caller, rec) {
  const f = rec.fields || {};
  const me = String(caller.name || '').trim().toLowerCase();
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

  /* ⚠️ Identity BEFORE the try. Inside it, requireCaller's 401 would be caught
     by the handler's own catch and returned as a 500 — the failure mode the
     September auth audit called out. Every route below needs a caller: the
     meta route hands back the patroller picker, which is directory data. */
  const caller = await requireCaller(req, res);
  if (!caller) return;

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
        const rec = await findOpenReport(caller.name);
        return res.status(200).json({ row: rec ? shape(rec) : null });
      }
      if (req.query?.check === 'shift') {
        const dup = await findSameShift({
          patroller: req.query.patroller, shiftDate: req.query.shiftDate, shift: req.query.shift,
        });
        return res.status(200).json({ exists: !!dup, row: dup ? shape(dup) : null });
      }
      const mine = String(req.query?.mine || '') === '1' || !caller.isAdmin;
      const recs = await fetchRows({ mine, who: caller.name });
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
      } else if (!body.patroller && !caller.name) {
        return res.status(400).json({ error: 'Patroller is required' });
      }

      const existing = await findByReportId(body.reportId);
      if (existing) return res.status(200).json({ row: shape(existing), duplicate: true });

      const fields = toFields({ ...body, submittedBy: body.submittedBy || caller.name });
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
        if (!caller.isAdmin) return res.status(403).json({ error: 'Only supervisors and administrators can review reports.' });
        const f = { [F.reviewedBy]: caller.name, [F.reviewedAt]: new Date().toISOString() };
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
      if (!ownsRow(caller, rec) && !caller.isAdmin)
        return res.status(403).json({ error: 'This report belongs to another patroller.' });

      /* The flush from section 7 of the report: raise these and nothing else.
         Deliberately its own path — it carries no report fields, so it cannot
         half-write the rest of the report on a connection good enough for one
         request and not the next. */
      if (Array.isArray(body.raiseDeficiencies)) {
        const out = await raiseDeficiencies(body.id, rec, body.raiseDeficiencies);
        return res.status(200).json({ raised: out.raised, note: out.note, row: out.row || shape(rec) });
      }

      const submitting = body.submit === true;
      if (submitting) {
        // Validate the merged picture: what is already stored, overlaid with
        // whatever this final save is sending.
        const merged = { ...shape(rec), ...stripUndefined(body) };
        const problem = validateComplete(merged);
        if (problem) return res.status(400).json({ error: problem });
      }

      /* Last chance for the deficiencies. The server has a connection even when
         the tablet does not, and after this the report is closed for editing.
         After validation, so a report that is going to be refused does not raise
         work orders on its way to a 400 — and best-effort, because the report
         must be filed whatever the DMT is doing. */
      let mergedDefs = null;
      if (submitting) {
        const pend = mergeDefs(parseDefs(rec.fields?.[F.defsJson]),
                               cleanDefs(body.deficiencyRows) || [], null).filter(d => !d.wo);
        if (pend.length) {
          const out = await raiseDeficiencies(body.id, rec, pend);
          if (out.merged) mergedDefs = out.merged;
        }
      }

      /* mergedDefs last: toFields would otherwise write the client's older view
         of the same rows straight over the work order numbers just recorded. */
      const fields = toFields({ ...body,
        ...(mergedDefs ? { deficiencyRows: mergedDefs } : {}),
        submittedBy: rec.fields?.[F.submittedBy] || caller.name });
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


/* Merge what is stored on the report with what the client just sent, keyed on
   seq. A work order number already recorded is never blanked by an incoming row
   that has not heard about it yet — the DMT has the record either way, and
   losing the number here would mean raising it again. */
function mergeDefs(stored, incoming, woBySeq) {
  const bySeq = new Map();
  (stored || []).forEach(d => bySeq.set(d.seq, d));
  (incoming || []).forEach(d => {
    const prev = bySeq.get(d.seq);
    bySeq.set(d.seq, { ...d, wo: (prev && prev.wo) || d.wo || '' });
  });
  (woBySeq || new Map()).forEach((wo, seq) => {
    const d = bySeq.get(seq);
    if (!d) return;
    /* Only ever FILL a work order number, never replace one. A row that is
       re-sent so its photo can catch up comes back with the number it already
       had — but if the DMT ever answered with a different one, overwriting
       would throw away the reference the patroller has already been shown and
       quoted. A disagreement is a signal, not a correction. */
    if (!d.wo) d.wo = wo;
    else if (d.wo !== wo) console.error(`patrol: DMT answered ${wo} for a deficiency already recorded as ${d.wo}`);
  });
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(0, MAX_DEFS);
}

const defReady = d => !!(d && d.standard && d.finding && d.route && d.km !== undefined && d.description);

/* Hand the rows to the DMT and record what came back.
   ⚠️ NEVER THROWS. Every failure returns { raised: [] } with a note; the rows
   stay on the report and go out on the next save, the next `online`, or at
   submit. A deficiency can be raised late. A shift report lost to a DMT outage
   cannot be recovered at all. */
async function raiseDeficiencies(recId, rec, incoming) {
  const f = rec.fields || {};
  const reportId = f[F.reportId] || '';
  const stored = parseDefs(f[F.defsJson]);
  const list = cleanDefs(incoming) || [];
  const alreadyWo = new Set(stored.filter(d => d.wo).map(d => d.seq));
  /* Two reasons to send a row.
     1. It has never been raised.
     2. It HAS been raised and its photos have only just finished uploading. A
        patroller on one bar raises the pothole immediately, because the OMM
        clock is running, and the 4 MB picture lands minutes later. Intake
        matches on the Deficiency ID, so the second send backfills the photo
        onto the same work order rather than raising a second one. */
  const send = list.filter(d => defReady(d) && (
    (!alreadyWo.has(d.seq) && !d.wo) ||
    (d.photos.length && !d.photosSent)
  ));

  if (!reportId) return { raised: [], note: 'the report has no Report ID yet', merged: null };
  if (!send.length) return { raised: [], note: 'nothing to raise', merged: null };

  let results = [];
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), DMT_TIMEOUT_MS);
    try {
      const r = await fetch(DMT_INTAKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-intake-key': DMT_INTAKE_SECRET },
        signal: ctl.signal,
        body: JSON.stringify({ deficiencies: send.map(d => ({
          // Derived from the report, so a retry hits intake's existingWO() and
          // returns the SAME work order instead of raising a second one.
          deficiencyId: deficiencyId(reportId, d.seq),
          source:       'Road patrol',
          reportedBy:   f[F.patroller] || '',
          dateObserved: f[F.shiftDate] || '',
          standard:     d.standard,
          finding:      d.finding,
          route:        d.route,
          km:           d.km,
          description:  d.description,
          ...(d.photos.length ? { photoUrls: d.photos } : {}),
          ...(d.toKm !== undefined ? { toKm: d.toKm } : {}),
          ...(d.direction ? { direction: d.direction } : {}),
          // Intake's own names for these three. assetId drives its asset lookup
          // and its duplicate check, so it must not be dropped in transit.
          ...(d.assetId ? { assetId: d.assetId } : {}),
          ...(d.side ? { side: d.side } : {}),
          ...(d.lat !== undefined ? { latitude: d.lat } : {}),
          ...(d.lng !== undefined ? { longitude: d.lng } : {}),
        })) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || `intake ${r.status}`);
      results = Array.isArray(j.results) ? j.results : [];
    } finally { clearTimeout(timer); }
  } catch (e) {
    console.error('patrol: DMT intake hand-off failed:', e.message);
    return { raised: [], note: `the DMT could not be reached (${e.message})`, merged: null };
  }

  /* Intake answers positionally — one result per deficiency, in order — and its
     create path does not echo the deficiencyId back, so position is the only
     thing to match on. If the counts disagree, something is different from what
     this code believes and guessing would attach a work order number to the
     wrong pothole. Say so and let the next attempt idempotency-match instead. */
  if (results.length !== send.length) {
    console.error(`patrol: intake returned ${results.length} results for ${send.length} deficiencies`);
    return { raised: [], note: 'the DMT answered with an unexpected shape', merged: null };
  }

  /* Intake's own "is this already reported?" answer rides back on each result
     (DMT Tool/api/intake.js). It is computed BEFORE the work order is written,
     so it never finds the one it has just raised. Both work orders exist either
     way — this only lets the patroller and the depot see that the two may be the
     same pothole, rather than finding out when someone drives out twice. */
  const raised = [];
  const woBySeq = new Map();
  const dupBySeq = new Map();
  send.forEach((d, i) => {
    const r = results[i] || {};
    const wo = r.workOrder;
    if (!wo) return;
    const dup = (r.possibleDuplicates || [])[0];
    const dupWo = dup && dup['Work Order #'] ? String(dup['Work Order #']) : '';
    raised.push({ seq: d.seq, workOrder: String(wo), duplicateOf: dupWo || undefined });
    woBySeq.set(d.seq, String(wo));
    if (dupWo) dupBySeq.set(d.seq, dupWo);
  });
  if (!raised.length) return { raised: [], note: 'the DMT raised nothing', merged: null };

  const merged = mergeDefs(stored, list, woBySeq);
  merged.forEach(d => { const x = dupBySeq.get(d.seq); if (x) d.dup = x; });
  /* Only the rows the DMT actually acknowledged are marked delivered. A row
     whose send failed stays unmarked and is tried again — the alternative is a
     photo that silently never reaches the work order. */
  const done = new Set(raised.map(r => r.seq));
  merged.forEach(d => { if (done.has(d.seq) && d.photos.length) d.photosSent = true; });
  try {
    const updated = await airtable(`${BASE}/${encodeURIComponent(TABLE)}/${encodeURIComponent(recId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        fields: {
          [F.defsJson]:   merged.length ? JSON.stringify(merged) : '',
          [F.defsRaised]: merged.filter(d => d.wo).length,
          [F.defsWos]:    merged.map(d => d.wo).filter(Boolean).join('\n'),
        },
        returnFieldsByFieldId: true,
      }),
    });
    return { raised, note: '', merged, row: shape(updated) };
  } catch (e) {
    /* The work orders EXIST — they are in the DMT with their numbers. Only this
       report's copy of them failed to save. Hand the numbers back anyway so the
       patroller sees them, and let the next save record them: the deficiencyId
       makes a re-send return the same numbers rather than duplicate them. */
    console.error('patrol: raised in the DMT but could not record it here:', e.message);
    return { raised, note: `raised, but not yet recorded on the report (${e.message})`, merged };
  }
}

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
  SUMMER_TITLES, WINTER_TITLES, getChoices,
  // section 7 — the deficiencies raised from the report
  F, cleanDef, cleanDefs, parseDefs, mergeDefs, defReady, deficiencyId,
  toFields, shape, raiseDeficiencies, MAX_DEFS, MAX_DESC, MAX_PHOTOS,
  PHOTO_URL, DMT_INTAKE_URL,
};
