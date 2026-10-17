// api/coverage.js — road-patrol-api
//
// Patrol coverage against OMM 801 (Troy, 2026-10-16: "lets do that" — the check an
// auditor or the province would ask for). From the filed Patrol Reports it answers,
// day by day and route by route, whether the facility was patrolled as often as the
// contract requires.
//
// The requirement (OMM 801.2.2, read from the Quality OMM 801 audit forms, and the
// Winter Operations Management Plan §4–5):
//
//   Core winter, 1 Nov – 31 Mar     a DAY and a NIGHT patrol, every route, every day
//   Everything else (summer, and    a DAY patrol, every route, every day
//   the Oct 15–31 / Apr 1–15
//   transitions)
//   Every week (Sun–Sat)            at least one NIGHT patrol with luminaires and sign
//                                   reflectivity checked (and pavement markings in core
//                                   winter) — 801.2.2 / Winter Plan §5
//
// "Per direction": a route on a report counts for both directions — a patroller drives
// a route out and back (Troy, 2026-10-16, chose this over adding direction ticks).
//
// The routes that make up "the facility" follow the patrol report's own lists: the
// four summer routes, or the eight winter routes (Western: Oromocto E/W, Mazerolle,
// Route 7; Eastern: Bagdad E/W, River Glade E/W) from 15 Oct to 15 Apr.
//
// A report counts once it is Submitted (or Reviewed / Flagged). One still In progress
// is shown as in progress, not met — the day is not over for it yet.
//
//   GET ?from=YYYY-MM-DD&to=YYYY-MM-DD    supervisors/admins only (isAdmin), ≤ 93 days
//
// Read only. Nothing here writes.

const L = require('./_lib');
const { requireAdmin } = require('./_auth');

const BASE  = process.env.AIRTABLE_BASE || 'app2m7rkP51kLLpbe';
const TABLE = process.env.PATROL_TABLE  || 'tblosu2dzKTwhuHnf';
const F = {
  reportId: 'fldZ4JDUx4Tqc3eQ2', shiftDate: 'fldjJZKRSkgEvcR1O', season: 'fldbG2jazLXbVSxNC', shift: 'fldcNyZwC9MmebOz7',
  patroller: 'fld2yQSx8QJ3Netq3', routes: 'fldnh3pvj0twZu5Fe', status: 'fldn1x0NeaoDQrlcq',
  illumination: 'fldtBUHrNfrNPPRH3', markings: 'fldgLY0djjNO5CffH', reflectivity: 'fldpKan2QFOMO1lZ5',
  depot: 'fld3gAxGzV1VTSDWn', division: 'fldxSnElZ4qJ6baHr',
};
const SUMMER_ROUTES = ['Oromocto East', 'Oromocto West', 'River Glade East', 'River Glade West'];
const WINTER_ROUTES = ['Oromocto East', 'Oromocto West', 'Mazerolle', 'Route 7', 'Bagdad East', 'Bagdad West', 'River Glade East', 'River Glade West'];
const COUNTS = ['Submitted', 'Reviewed', 'Flagged'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 93;

function todayAtlantic(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Moncton', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const md = iso => iso.slice(5);   // MM-DD
const weekday = iso => new Date(iso + 'T12:00:00Z').getUTCDay();

/* The contractual period a date falls in. */
function periodFor(iso) {
  const m = md(iso);
  if (m >= '11-01' || m <= '03-31') return 'core-winter';
  if ((m >= '10-15' && m <= '10-31') || (m >= '04-01' && m <= '04-15')) return 'transition';
  return 'summer';
}
const winterRoutes = iso => { const m = md(iso); return m >= '10-15' || m <= '04-15'; };
function requirementFor(iso) {
  const period = periodFor(iso);
  return { period, routes: winterRoutes(iso) ? WINTER_ROUTES : SUMMER_ROUTES, night: period === 'core-winter' };
}

function reportOut(r) {
  const f = r.fields || {};
  return {
    id: r.id, reportId: f[F.reportId] || '', date: f[F.shiftDate] || '', shift: L.sel(f[F.shift]) || '',
    season: L.sel(f[F.season]) || '', patroller: f[F.patroller] || '', status: L.sel(f[F.status]) || '',
    routes: L.arr(f[F.routes]).map(L.sel).filter(Boolean),
    illumination: !!f[F.illumination], reflectivity: !!f[F.reflectivity], markings: !!f[F.markings],
    depot: L.sel(f[F.depot]) || '', division: L.sel(f[F.division]) || '',
  };
}

/* The whole computation, pure, so the tests drive it directly. */
function coverage(reports, from, to, today) {
  const live = reports.filter(r => r.date >= from && r.date <= to && (COUNTS.includes(r.status) || r.status === 'In progress'));
  const days = [];
  const byRoute = {};
  let daysCounted = 0, daysMet = 0, slots = 0, slotsMet = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const req = requirementFor(d);
    const onDay = live.filter(r => r.date === d);
    const future = d > today, isToday = d === today;
    const shifts = req.night ? ['Day', 'Night'] : ['Day'];
    const rows = req.routes.map(route => {
      const cells = {};
      for (const s of shifts) {
        const hits = onDay.filter(r => r.shift === s && r.routes.includes(route));
        const done = hits.filter(r => COUNTS.includes(r.status));
        const state = future ? 'future' : done.length ? 'met' : hits.length ? 'in-progress' : isToday ? 'pending' : 'missed';
        cells[s] = { state, reports: hits.map(r => ({ id: r.id, reportId: r.reportId, patroller: r.patroller, status: r.status })) };
        if (!future && !isToday) {
          slots++; if (state === 'met') slotsMet++;
          const k = route + ' · ' + s;
          byRoute[k] = byRoute[k] || { route, shift: s, required: 0, met: 0 };
          byRoute[k].required++; if (state === 'met') byRoute[k].met++;
        }
      }
      return { route, cells };
    });
    const missing = [];
    rows.forEach(rw => shifts.forEach(s => { if (rw.cells[s].state === 'missed') missing.push(`${rw.route} (${s.toLowerCase()})`); }));
    const met = !future && rows.every(rw => shifts.every(s => rw.cells[s].state === 'met'));
    if (!future && !isToday) { daysCounted++; if (met) daysMet++; }
    // Reports whose routes are not on this date's list (e.g. a winter report filed after 15 Apr).
    const extra = [...new Set(onDay.flatMap(r => r.routes).filter(x => !req.routes.includes(x)))];
    days.push({ date: d, period: req.period, nightRequired: req.night, state: future ? 'future' : isToday ? 'today' : met ? 'met' : 'missed',
      routes: rows, missing, extraRoutes: extra, reports: onDay.length });
  }
  // Weekly night check: a Night report with luminaires and sign reflectivity checked
  // (pavement markings too in core winter) in each Sun–Sat week.
  const weeks = [];
  let ws = addDays(from, -weekday(from));
  for (; ws <= to; ws = addDays(ws, 7)) {
    const we = addDays(ws, 6);
    const lo = ws < from ? from : ws, hi = we > to ? to : we;
    const coreWeek = periodFor(ws) === 'core-winter' || periodFor(we) === 'core-winter';
    const nights = live.filter(r => r.date >= lo && r.date <= hi && r.shift === 'Night' && COUNTS.includes(r.status));
    const ok = nights.filter(r => r.illumination && r.reflectivity && (!coreWeek || r.markings));
    const partial = ws < from || we > to;
    const future = lo > today;
    const state = future ? 'future' : ok.length ? 'met' : (we >= today ? 'open' : partial ? 'partial' : 'missed');
    weeks.push({ start: ws, end: we, partial, needMarkings: coreWeek, state,
      reports: ok.map(r => ({ id: r.id, reportId: r.reportId, date: r.date, patroller: r.patroller })),
      nightReports: nights.length });
  }
  const weeksCounted = weeks.filter(w => ['met', 'missed'].includes(w.state));
  return {
    range: { from, to, today },
    days, weeks,
    summary: {
      daysCounted, daysMet, pctDays: daysCounted ? Math.round(100 * daysMet / daysCounted) : null,
      slots, slotsMet, pctSlots: slots ? Math.round(100 * slotsMet / slots) : null,
      weeksCounted: weeksCounted.length, weeksMet: weeksCounted.filter(w => w.state === 'met').length,
      byRoute: Object.values(byRoute),
      reportsUsed: live.filter(r => COUNTS.includes(r.status)).length,
      inProgress: live.filter(r => r.status === 'In progress').length,
    },
  };
}

async function fetchReports(from, to) {
  const out = [];
  let offset = '';
  const formula = `AND(NOT(IS_BEFORE({Shift Date},'${from}')),NOT(IS_AFTER({Shift Date},'${to}')))`;
  do {
    const qs = new URLSearchParams({ pageSize: '100', returnFieldsByFieldId: 'true', filterByFormula: formula });
    Object.values(F).forEach(id => qs.append('fields[]', id));
    if (offset) qs.set('offset', offset);
    const page = await L.airtable(`${BASE}/${TABLE}?${qs}`);
    out.push(...(page.records || []).map(reportOut));
    offset = page.offset || '';
  } while (offset);
  return out;
}

module.exports = async function handler(req, res) {
  if (L.cors(req, res)) return;
  const caller = await requireAdmin(req, res, 'Patrol coverage is for supervisors and administrators.');
  if (!caller) return;
  try {
    const Q = req.query || {};
    const today = todayAtlantic();
    const to = ISO.test(String(Q.to || '')) ? String(Q.to) : today;
    const from = ISO.test(String(Q.from || '')) ? String(Q.from) : to.slice(0, 8) + '01';
    if (from > to) return res.status(400).json({ error: 'From must be on or before To.' });
    if ((Date.parse(to) - Date.parse(from)) / 864e5 + 1 > MAX_DAYS) return res.status(400).json({ error: `At most ${MAX_DAYS} days at a time.` });
    const reports = await fetchReports(from, to);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, ...coverage(reports, from, to, today) });
  } catch (e) {
    console.error('[coverage]', e.message);
    return res.status(500).json({ error: 'Could not build the coverage report', detail: e.message });
  }
};
module.exports.lib = { coverage, periodFor, requirementFor, SUMMER_ROUTES, WINTER_ROUTES };
