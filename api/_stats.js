// api/_stats.js — road-patrol-api
//
// Patroller stats (Troy, 2026-10-23: "I would like to have a patroller stats page on the
// patrol app" — "There is nothing private, everyone can see"). Served by coverage.js as
// GET /api/coverage?view=stats&from=YYYY-MM-DD&to=YYYY-MM-DD — no new serverless function:
// the project is at the Vercel Hobby limit of 12.
//
// One row per person, counted from what they filed in the range:
//   Shifts      Patrol Reports where they are the Patroller (Submitted / Reviewed / Flagged;
//               In progress counted apart) — day / night, hours (Shift Hours formula), route
//               patrols, night checks (luminaires + sign reflectivity), reviewed, flagged,
//               filed late (submitted after the day following the shift date)
//   Deficiencies  reports with Deficiencies = Yes, deficiency rows logged, work orders raised
//   Incidents   MVAs (Patroller), accident reports (Patroller), investigations (Investigator),
//               animals / breakdowns / areas of concern (Reported By), advisories issued
//               (Issued By), RWIS checks (Checked By), road condition observations (Patroller)
//   Paperwork   open: patrol reports still In progress from before today, accident reports
//               and investigations still Draft — each listed with a link
//
// Names are matched case- and space-insensitively; the Employees directory spelling wins.
// Everyone signed in to Patrol may read it (requireCaller in coverage.js). Read only.

const L = require('./_lib');

const P_BASE = process.env.AIRTABLE_BASE || 'app2m7rkP51kLLpbe';
const M_BASE = process.env.MVA_BASE || 'appMKaiabPAPx3JaV';
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;
const COUNTS = ['Submitted', 'Reviewed', 'Flagged'];
const PATROLLER_TITLES = ['Patroller - Full Time', 'Patroller - Winter'];

/* Every table read, the person field, the date field, and the extra fields kept. */
const SRC = {
  shifts: { base: P_BASE, table: process.env.PATROL_TABLE || 'tblosu2dzKTwhuHnf', who: 'fld2yQSx8QJ3Netq3', when: 'fldjJZKRSkgEvcR1O',
    formula: (from) => `NOT(IS_BEFORE({Shift Date},'${from}'))`,
    f: { reportId: 'fldZ4JDUx4Tqc3eQ2', shift: 'fldcNyZwC9MmebOz7', status: 'fldn1x0NeaoDQrlcq', routes: 'fldnh3pvj0twZu5Fe',
      hours: 'fldwAxF512NrUYdnQ', deficiencies: 'fldMXKeXvFRjqbknW', defsJson: 'fldivNgQ0BW6Uj6Qd', defsRaised: 'fldk2XbHe7J5y7iwU',
      illumination: 'fldtBUHrNfrNPPRH3', reflectivity: 'fldpKan2QFOMO1lZ5', submittedAt: 'fldTQy3UXRJoOnbCN' } },
  mvas:        { base: M_BASE, table: process.env.MVA_TABLE || 'tblFnoVfyA9nSEOwk', who: 'fld52QNBDHZQfx5za', when: 'fld8dDEK0xlJqPUzS', when2: 'fldyNaXuFj9LTbelQ',
    f: { no: 'flddJ5v5jZ9rv4VWg' } },
  accidents:   { base: M_BASE, table: process.env.MVA_AR_TABLE || 'tblShwnpWGogKaZxG', who: 'fldAIEl5C8asyAZzp', when: 'fldqsmXUkmNSqmlpH', who2: 'fldSvWTmRupVXfn6H',
    f: { no: 'fldK8gqs6PfZAXNs9', status: 'fldRa0KV1HJzLMOjH', mva: 'fldD01RPTQaqHh5aT' } },
  investigations: { base: M_BASE, table: 'tblA5YveLsiSYd98t', who: 'fldu8z1OpJYo2Mjtp', when: 'fldSxull8ZS33Tsj9',
    f: { no: 'fldCNGwdH57csZuUV', status: 'fldnSafV7m2ll4Xf3', mva: 'fldBJWC0xPHcECoRq' } },
  animals:     { base: P_BASE, table: 'tbl8avT8C3tPbP8n4', who: 'flducvuwgZNuEm7bx', when: 'fldn99xV5zaKORfOY', f: {} },
  breakdowns:  { base: P_BASE, table: 'tblr5LJ7LSgXZgj36', who: 'fldG2EXHoLMBMPeot', when: 'flddAMfLPg3mryZRO', f: {} },
  concerns:    { base: P_BASE, table: 'tbljQKCdR9P6DsYiL', who: 'fldaX1kHURONR8gHJ', when: 'fldmr5tbNmbSK94vC', f: {} },
  advisories:  { base: P_BASE, table: 'tblF6YUnUTdRF6e3K', who: 'fldsyf6ZZ2CYAIYhj', when: 'fldCO1lSuX1LPWGGc', f: {} },
  rwis:        { base: P_BASE, table: 'tblfnW5kpD7SkTOqv', who: 'fldsuhcrPZ74ZOxTZ', when: 'fldhdlXIflupql2sI', f: {} },
  conditions:  { base: P_BASE, table: 'tblEIzL4ESYpnotMU', who: 'fldLSZDQglSOuuMBW', when: 'fldf7cZDZHN8Vj4a4', f: {} },
};

const norm = n => String(n || '').trim().replace(/\s+/g, ' ').toLowerCase();
function dayOf(v) {
  if (!v) return '';
  const s = String(v);
  if (ISO.test(s)) return s;
  const d = new Date(s); if (isNaN(d)) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Moncton', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function defRows(raw) { if (!raw) return 0; try { const a = JSON.parse(raw); return Array.isArray(a) ? a.length : 0; } catch (_) { return 0; } }
const numOr0 = v => (typeof v === 'number' && isFinite(v) ? v : 0);

/* Rows out of Airtable, flattened to { kind, who, date, … }. */
function flatten(kind, rec) {
  const s = SRC[kind], f = rec.fields || {};
  const who = String(f[s.who] || (s.who2 && f[s.who2]) || '').trim();
  const date = dayOf(f[s.when]) || (s.when2 ? dayOf(f[s.when2]) : '') || dayOf(rec.createdTime);
  const o = { kind, id: rec.id, who, date };
  for (const [k, id] of Object.entries(s.f)) o[k] = f[id];
  if (kind === 'shifts') {
    o.shift = L.sel(o.shift); o.status = L.sel(o.status) || 'In progress';
    o.routes = L.arr(o.routes).map(L.sel).filter(Boolean);
  }
  if (o.status !== undefined && kind !== 'shifts') o.status = L.sel(o.status) || 'Draft';
  if (o.mva !== undefined) o.mva = L.arr(o.mva)[0] || '';
  return o;
}

function blank(name) {
  return { name, shifts: 0, day: 0, night: 0, hours: 0, routePatrols: 0, nightChecks: 0, reviewed: 0, flagged: 0, late: 0,
    defReports: 0, defRows: 0, workOrders: 0,
    mvas: 0, accidents: 0, investigations: 0, animals: 0, breakdowns: 0, concerns: 0, advisories: 0, rwis: 0, conditions: 0,
    open: [], lastShift: '' };
}

/* The whole computation, pure, so the tests drive it directly. */
function stats(rows, from, to, today, roster) {
  const people = {};
  const nameOf = {};
  (roster || []).forEach(p => { nameOf[norm(p.name)] = p.name; });
  const get = who => {
    const k = norm(who); if (!k) return null;
    return people[k] || (people[k] = blank(nameOf[k] || who));
  };
  (roster || []).filter(p => p.patroller).forEach(p => get(p.name));
  const inRange = r => r.date && r.date >= from && r.date <= to;
  let unassigned = 0;

  for (const r of rows) {
    if (!inRange(r)) continue;
    const p = get(r.who);
    if (!p) { unassigned++; continue; }
    switch (r.kind) {
      case 'shifts': {
        if (r.status === 'In progress') {
          if (r.date < today) p.open.push({ kind: 'Patrol report', ref: r.reportId || 'Report', date: r.date, status: 'In progress', href: 'reports.html?id=' + encodeURIComponent(r.id) });
          break;
        }
        if (!COUNTS.includes(r.status)) break;
        p.shifts++;
        if (r.shift === 'Night') p.night++; else p.day++;
        p.hours += numOr0(r.hours);
        p.routePatrols += r.routes.length;
        if (r.illumination && r.reflectivity) p.nightChecks++;
        if (r.status === 'Reviewed') p.reviewed++;
        if (r.status === 'Flagged') p.flagged++;
        const sub = dayOf(r.submittedAt);
        if (sub && sub > addDays(r.date, 1)) p.late++;
        if (r.deficiencies) p.defReports++;
        p.defRows += defRows(r.defsJson);
        p.workOrders += numOr0(r.defsRaised);
        if (r.date > p.lastShift) p.lastShift = r.date;
        break;
      }
      case 'accidents':
        p.accidents++;
        if (r.status === 'Draft') p.open.push({ kind: 'Accident report', ref: r.no || 'Accident report', date: r.date, status: 'Draft', href: r.mva ? 'accident.html?mva=' + encodeURIComponent(r.mva) : 'mvas.html' });
        break;
      case 'investigations':
        p.investigations++;
        if (r.status === 'Draft') p.open.push({ kind: 'Investigation', ref: r.no || 'Investigation', date: r.date, status: 'Draft', href: r.mva ? 'investigation.html?mva=' + encodeURIComponent(r.mva) : 'mvas.html' });
        break;
      default:
        p[r.kind]++;
    }
  }

  const list = Object.values(people).map(p => {
    p.hours = Math.round(p.hours * 10) / 10;
    p.incidents = p.mvas + p.animals + p.breakdowns + p.concerns + p.advisories;
    p.open.sort((a, b) => a.date.localeCompare(b.date));
    p.openCount = p.open.length;
    p.active = !!(p.shifts || p.incidents || p.accidents || p.investigations || p.rwis || p.conditions || p.openCount);
    return p;
  }).sort((a, b) => b.shifts - a.shifts || b.hours - a.hours || a.name.localeCompare(b.name));

  const SUM = ['shifts', 'day', 'night', 'hours', 'routePatrols', 'nightChecks', 'reviewed', 'flagged', 'late', 'defReports', 'defRows', 'workOrders',
    'mvas', 'accidents', 'investigations', 'animals', 'breakdowns', 'concerns', 'advisories', 'rwis', 'conditions', 'incidents', 'openCount'];
  const team = {};
  SUM.forEach(k => { team[k] = list.reduce((s, p) => s + p[k], 0); });
  team.hours = Math.round(team.hours * 10) / 10;
  team.people = list.filter(p => p.active).length;
  return { range: { from, to, today }, team, people: list, unassigned };
}

async function fetchKind(kind, from) {
  const s = SRC[kind];
  const out = [];
  let offset = '';
  // Shift Date is known by name; for the rest, a record is never created before the thing it
  // records happened, so CREATED_TIME() on or after the day before `from` is a safe pre-filter.
  const formula = s.formula ? s.formula(from) : `IS_AFTER(CREATED_TIME(),'${addDays(from, -1)}')`;
  do {
    const qs = new URLSearchParams({ pageSize: '100', returnFieldsByFieldId: 'true', filterByFormula: formula });
    [s.who, s.who2, s.when, s.when2, ...Object.values(s.f)].filter(Boolean).forEach(id => qs.append('fields[]', id));
    if (offset) qs.set('offset', offset);
    const page = await L.airtable(`${s.base}/${s.table}?${qs}`);
    out.push(...(page.records || []).map(r => flatten(kind, r)));
    offset = page.offset || '';
  } while (offset);
  return out;
}

async function roster() {
  const all = await L.getEmployees();
  return all.map(e => ({ name: e.name, patroller: e.active && e.titles.some(t => PATROLLER_TITLES.includes(t)) }));
}

function todayAtlantic() { return dayOf(new Date().toISOString()); }

async function handle(req, res) {
  const Q = req.query || {};
  const today = todayAtlantic();
  const to = ISO.test(String(Q.to || '')) ? String(Q.to) : today;
  const from = ISO.test(String(Q.from || '')) ? String(Q.from) : to.slice(0, 8) + '01';
  if (from > to) return res.status(400).json({ error: 'From must be on or before To.' });
  if ((Date.parse(to) - Date.parse(from)) / 864e5 + 1 > MAX_DAYS) return res.status(400).json({ error: `At most ${MAX_DAYS} days at a time.` });
  const missing = [];
  const parts = await Promise.all(Object.keys(SRC).map(k => fetchKind(k, from).catch(e => { console.error('[stats]', k, e.message); missing.push(k); return []; })));
  const r = stats(parts.flat(), from, to, today, await roster());
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, ...r, missing });
}

module.exports = { handle, stats, flatten, SRC, dayOf, MAX_DAYS };
