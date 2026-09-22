/*
 * test-patrol-deficiencies.js — deficiencies raised from the shift report
 * ---------------------------------------------------------------------------
 * Run:  node <repo>/road-patrol-api/_tests/test-patrol-deficiencies.js
 * Zero dependencies, no browser, no network. patrol.js is loaded with ./_lib
 * stubbed, and its deficiency helpers are run for real.
 *
 * Troy: "is it better to have shortcuts on the main patroller page to the other
 * forms, or within the road patrol report once started so the patroller stays on
 * the report?" The DMT's own numbers answered it — 404 work orders sourced "Road
 * patrol" in 90 days, one or two per patroller per shift — so deficiencies are
 * raised from inside the report.
 *
 * FOUR PROPERTIES, and the suite is mostly about breaking them on purpose.
 *
 * 1. THE DMT STAYS THE SYSTEM OF RECORD. Nothing here writes a work order. Each
 *    row goes to the DMT's /api/intake, the same single write path Device Magic
 *    and the Quality audits use, and a number comes back.
 * 2. A DMT OUTAGE MUST NOT COST THE REPORT. Every failure is caught; the rows
 *    stay on the report and go out on the next save, the next `online`, or at
 *    submit. A deficiency raised late is late. A shift report lost is gone.
 * 3. A RETRY MUST NOT RAISE IT TWICE. deficiencyId is "<Report ID>-D03",
 *    derived from the report, so intake's existingWO() returns the SAME work
 *    order instead of a second one. The seq is never reused.
 * 4. `deficiencies` IS ALREADY TAKEN. It is the section 5 checkbox ("OMM
 *    deficiencies entered during shift"). The rows travel as `deficiencyRows`.
 *    The first version of this used the same name for both: shape() silently
 *    returned an array where the checkbox belonged, and collectBody()'s CHECKS
 *    loop silently replaced the rows with a boolean, so nothing would ever have
 *    been saved. Both halves are pinned below.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const Module = require('module');

const API = path.join(__dirname, '..', 'api', 'patrol.js');

// patrol.js requires ./_lib at load; stub it so this runs with no credentials.
const libPath = path.join(__dirname, '..', 'api', '_lib.js');
let airtableCalls = [];
let airtableFail = null;
require.cache[libPath] = {
  id: libPath, filename: libPath, loaded: true, exports: {
    arr: x => (Array.isArray(x) ? x : x == null ? [] : [x]),
    sel: x => (x && x.name) || x || '',
    num: x => (x === '' || x == null ? undefined : Number(x)),
    esc: s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),
    airtable: async (url, opts) => {
      airtableCalls.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null });
      if (airtableFail) throw new Error(airtableFail);
      const b = opts && opts.body ? JSON.parse(opts.body) : {};
      return { id: 'recRPT0000000001', fields: b.fields || {} };
    },
    cors: () => {}, isAdmin: () => false, callerName: () => 'T. Johnston',
    parseBody: r => r.body || {},
    getEmployees: async () => [], getPatrollers: async () => [],
    uploadAttachment: async () => '', sendMail: async () => {}, sendMailDetailed: async () => ({}),
  },
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (req === './_lib') return libPath;
  return origResolve.call(this, req, ...rest);
};
const patrol = require(API);
Module._resolveFilename = origResolve;
const T = patrol.__test;
const SRC = fs.readFileSync(API, 'utf8');

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, x) => { if (c) pass++; else { fail++; failures.push(n + (x ? ' — ' + x : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w),
                           `got ${JSON.stringify(g)} want ${JSON.stringify(w)}`);

ok('the deficiency helpers are exposed for testing',
   !!(T && T.cleanDefs && T.mergeDefs && T.raiseDeficiencies && T.deficiencyId));

/* ══ 1 · the deficiency id ════════════════════════════════════════════════ */
const RID = 'RP-20260921-1431-GO39';
eq('a deficiency id is derived from the report', T.deficiencyId(RID, 3), RID + '-D03');
eq('and is zero-padded so 3 and 30 cannot collide as text', T.deficiencyId(RID, 30), RID + '-D30');
eq('past 99 it simply gets longer rather than wrapping', T.deficiencyId(RID, 123), RID + '-D123');
ok('two rows on the same report never share one',
   T.deficiencyId(RID, 1) !== T.deficiencyId(RID, 2));
ok('and the same row on two reports never does either',
   T.deficiencyId(RID, 1) !== T.deficiencyId('RP-20260922-0600-AAAA', 1));

/* ══ 2 · what a row is allowed to be ══════════════════════════════════════ */
const row = (o = {}) => ({ seq: 1, standard: 'OMM 101', finding: 'Potholes', route: 'Route 2',
                           km: 312.4, description: 'Pothole in the eastbound lane.', ...o });
{
  const c = T.cleanDef(row());
  eq('a good row survives intact', [c.seq, c.standard, c.finding, c.route, c.km], [1, 'OMM 101', 'Potholes', 'Route 2', 312.4]);
  eq('and carries no work order until it has one', c.wo, '');
}
{
  /* This JSON comes from a browser and lands on a contractual record, so the
     shape is a whitelist, not a filter. */
  const c = T.cleanDef({ ...row(), evil: '<script>', wo: 'WO-1', Status: 'Closed', __proto__: { x: 1 } });
  const ALLOWED = ['description', 'direction', 'dup', 'finding', 'km', 'photos', 'photosSent',
                   'route', 'seq', 'standard', 'toKm', 'wo'];
  eq('unknown keys do not survive', Object.keys(c).filter(k => ALLOWED.indexOf(k) < 0), []);
  ok('nothing the client invented is there', !('evil' in c) && !('Status' in c) && !('x' in c),
     Object.keys(c).join(','));
  // An absent optional field is absent, not present-and-undefined.
  ok('and an optional one that was not given is simply not there', !('toKm' in c), Object.keys(c).join(','));
}
eq('a row with no usable seq is dropped', T.cleanDef({ ...row(), seq: 0 }), null);
eq('a fractional seq is dropped', T.cleanDef({ ...row(), seq: 1.5 }), null);
eq('a seq that is not a number is dropped', T.cleanDef({ ...row(), seq: 'one' }), null);
eq('and so is a wildly out-of-range one', T.cleanDef({ ...row(), seq: 100000 }), null);
eq('a non-object is dropped', T.cleanDef('OMM 101'), null);
{
  const c = T.cleanDef({ ...row(), description: 'x'.repeat(5000) });
  ok('a runaway description is cut to the cap', c.description.length === T.MAX_DESC, String(c.description.length));
}
{
  const c = T.cleanDef({ ...row(), km: '', toKm: '' });
  ok('a blank km is absent rather than zero', !('km' in c), JSON.stringify(c));
  ok('and so is a blank To KM', !('toKm' in c), JSON.stringify(c));
}
eq('a km given as text is stored as a number', T.cleanDef({ ...row(), km: '312.4' }).km, 312.4);
{
  const many = Array.from({ length: T.MAX_DEFS + 10 }, (_, i) => row({ seq: i + 1 }));
  eq('a shift cannot store an unbounded number of rows', T.cleanDefs(many).length, T.MAX_DEFS);
}
{
  /* Two rows sharing a seq would share a deficiencyId, and intake would merge
     them into ONE work order — two potholes, one repair. */
  const dupes = [row({ seq: 1, finding: 'Potholes' }), row({ seq: 1, finding: 'Water Ponding' })];
  const c = T.cleanDefs(dupes);
  eq('a duplicated seq is dropped rather than quietly sent', c.length, 1);
  eq('and it is the first one that stands', c[0].finding, 'Potholes');
}
eq('anything that is not a list is "the client said nothing"', T.cleanDefs('x'), null);
eq('and an empty list is a real, empty answer', T.cleanDefs([]), []);

/* ══ 2b · photos ══════════════════════════════════════════════════════════
   ⚠️ A photo URL goes onto a contractual work order. The browser uploads
   straight to Cloudinary and hands back what Cloudinary returned; anything else
   in that array is not a photo of a pothole, so only our own cloud is accepted.
   Working agreement §8 — cloud djrqifos6, unsigned preset uzh72cqd. */
const CL = 'https://res.cloudinary.com/djrqifos6/image/upload/v1/patrol-deficiencies/';
{
  const c = T.cleanDef(row({ photos: [CL + 'a.jpg', CL + 'b.jpg'] }));
  eq('our own cloud is accepted', c.photos.length, 2);
  eq('and a row starts out not yet delivered', c.photosSent, false);
}
for (const [what, u] of [
  ['somewhere else entirely', 'https://evil.example/a.jpg'],
  ['a look-alike host',       'https://res.cloudinary.com.evil.example/a.jpg'],
  ['plain http',              'http://res.cloudinary.com/djrqifos6/a.jpg'],
  ['a javascript: url',       'javascript:alert(1)'],
  ['a data: url',             'data:image/png;base64,iVBOR'],
  ['a protocol-relative url', '//res.cloudinary.com/djrqifos6/a.jpg'],
  ['the bare host',           'https://res.cloudinary.com/'],
  ['an empty string',         ''],
]) {
  eq(`a url pointing at ${what} is refused`, T.cleanDef(row({ photos: [u] })).photos, []);
}
eq('and something that is not a list at all is no photos',
   T.cleanDef(row({ photos: 'https://res.cloudinary.com/x/a.jpg' })).photos, []);
{
  const many = Array.from({ length: T.MAX_PHOTOS + 5 }, (_, i) => CL + i + '.jpg');
  eq('a row cannot carry an unbounded number', T.cleanDef(row({ photos: many })).photos.length, T.MAX_PHOTOS);
}
{
  const c = T.cleanDef(row({ photos: [CL + 'a.jpg', CL + 'a.jpg', CL + 'b.jpg'] }));
  eq('the same photo twice is one photo', c.photos.map(u => u.slice(-5)), ['a.jpg', 'b.jpg']);
}

/* ══ 3 · round-tripping through the record ════════════════════════════════ */
eq('an empty field parses to no rows', T.parseDefs(''), []);
eq('and so does something that is not JSON at all', T.parseDefs('{not json'), []);
eq('and so does JSON that is not a list', T.parseDefs('{"a":1}'), []);
{
  const stored = T.parseDefs(JSON.stringify([row({ seq: 2, wo: 'WO-2026-0884' }), row({ seq: 1 })]));
  eq('stored rows come back', stored.length, 2);
  eq('with their work order numbers', stored.filter(d => d.wo).map(d => d.wo), ['WO-2026-0884']);
}

/* ══ 4 · merging ══════════════════════════════════════════════════════════ */
{
  const stored = [row({ seq: 1, wo: 'WO-2026-0884' })];
  /* The tablet has been in a dead spot and does not know the number yet. The
     merge must NOT let its older view blank a work order that exists. */
  const incoming = [row({ seq: 1, wo: '' }), row({ seq: 2 })];
  const m = T.mergeDefs(stored, incoming, null);
  eq('the existing work order number survives an older client view', m[0].wo, 'WO-2026-0884');
  eq('and the new row comes along', m.length, 2);
  eq('sorted by seq', m.map(d => d.seq), [1, 2]);
}
{
  const m = T.mergeDefs([row({ seq: 1 })], [row({ seq: 1 })], new Map([[1, 'WO-2026-0900']]));
  eq('a number just returned by the DMT is written on', m[0].wo, 'WO-2026-0900');
}
{
  const m = T.mergeDefs([T.cleanDef(row({ seq: 9 }))], [], new Map([[7, 'WO-X']]));
  eq('a number for a row nobody has does not invent one', m.length, 1);
  eq('and does not land on the wrong row', m[0].wo, '');
}

/* ══ 5 · what counts as ready to send ═════════════════════════════════════ */
ok('a full row is ready', T.defReady(T.cleanDef(row())));
for (const [what, o] of [['no standard', { standard: '' }], ['no finding', { finding: '' }],
                         ['no route', { route: '' }], ['no km', { km: '' }],
                         ['no description', { description: '   ' }]]) {
  ok(`a row with ${what} is not ready`, !T.defReady(T.cleanDef(row(o))));
}
// km 0 is a real position on a route and must not read as "no km".
ok('a row at kilometre zero IS ready', T.defReady(T.cleanDef(row({ km: 0 }))));

/* ══ 6 · ⚠️ the name collision ════════════════════════════════════════════ */
{
  const f = {};
  f[T.F.reportId] = RID;
  f[T.F.deficiencies] = true;                       // the section 5 CHECKBOX
  f[T.F.defsJson] = JSON.stringify([row({ seq: 1, wo: 'WO-1' })]);
  const shaped = T.shape({ id: 'rec1', fields: f });
  eq('`deficiencies` is still the checkbox', shaped.deficiencies, true);
  ok('and the rows are somewhere else entirely', Array.isArray(shaped.deficiencyRows),
     JSON.stringify(shaped.deficiencyRows));
  eq('with the rows intact', shaped.deficiencyRows.length, 1);
  eq('and the two derived views beside them', [shaped.deficienciesRaised, shaped.workOrdersRaised],
     [null, '']);
}
{
  const out = T.toFields({ season: 'Summer', deficiencies: true,
                           deficiencyRows: [row({ seq: 1, wo: 'WO-1' }), row({ seq: 2 })] });
  eq('toFields writes the checkbox from `deficiencies`', out[T.F.deficiencies], true);
  ok('and the rows from `deficiencyRows`', !!out[T.F.defsJson], JSON.stringify(out[T.F.defsJson]));
  eq('the count is of rows that actually got a work order', out[T.F.defsRaised], 1);
  eq('and the numbers are listed one per line', out[T.F.defsWos], 'WO-1');
}
{
  // A partial draft save that says nothing about the rows must not wipe them —
  // the same rule the checkboxes already follow.
  const out = T.toFields({ season: 'Summer', comments: 'just the comments' });
  ok('a save that omits the rows leaves the field alone', !(T.F.defsJson in out), JSON.stringify(out));
}
{
  const out = T.toFields({ season: 'Summer', deficiencyRows: [] });
  eq('but an explicitly empty list clears it', out[T.F.defsJson], '');
  eq('and zeroes the count', out[T.F.defsRaised], 0);
  eq('and empties the list of numbers', out[T.F.defsWos], '');
}

/* ══ 7 · the hand-off to the DMT ══════════════════════════════════════════ */
const realFetch = global.fetch;
function stubIntake(opts = {}) {
  const seen = [];
  global.fetch = async (url, o) => {
    seen.push({ url: String(url), body: JSON.parse(o.body) });
    if (opts.throws) throw new Error(opts.throws);
    if (opts.notOk) return { ok: false, status: 500, json: async () => ({ ok: false, error: 'intake down' }) };
    const n = opts.results != null ? opts.results : JSON.parse(o.body).deficiencies.length;
    return { ok: true, status: 200, json: async () => ({ ok: true, count: n,
      results: Array.from({ length: n }, (_, i) => ({
        // intake's existingWO() branch echoes back the number it already has
        workOrder: opts.wo || ('WO-2026-' + String(900 + i)) })) }) };
  };
  return seen;
}
const recOf = (defsJson, extra = {}) => ({ id: 'recRPT0000000001', fields: {
  [T.F.reportId]: RID, [T.F.patroller]: 'Jeremy MacDonald', [T.F.shiftDate]: '2026-09-21',
  ...(defsJson ? { [T.F.defsJson]: defsJson } : {}), ...extra } });

(async () => {
{
  airtableCalls = []; airtableFail = null;
  const seen = stubIntake();
  const out = await T.raiseDeficiencies('recRPT0000000001', recOf(null), [row({ seq: 1 }), row({ seq: 2, finding: 'Water Ponding' })]);
  eq('both rows come back with a work order', out.raised.map(r => r.workOrder), ['WO-2026-900', 'WO-2026-901']);
  eq('matched to the right rows', out.raised.map(r => r.seq), [1, 2]);
  eq('the DMT is asked once, not once per row', seen.length, 1);
  ok('at the intake endpoint', /\/api\/intake$/.test(seen[0].url), seen[0].url);
  const sent = seen[0].body.deficiencies;
  eq('each carries an id derived from the report', sent.map(d => d.deficiencyId), [RID + '-D01', RID + '-D02']);
  eq('and says where it came from, in the DMT\'s own words', sent[0].source, 'Road patrol');
  eq('the patroller is named from the RECORD, not from the browser', sent[0].reportedBy, 'Jeremy MacDonald');
  eq('and the date observed is the shift date', sent[0].dateObserved, '2026-09-21');
  eq('the location travels', [sent[0].route, sent[0].km], ['Route 2', 312.4]);
  // Writing back: the rows, the count and the numbers.
  const wrote = airtableCalls[airtableCalls.length - 1].body.fields;
  eq('the report records how many were raised', wrote[T.F.defsRaised], 2);
  eq('and the numbers, one per line', wrote[T.F.defsWos], 'WO-2026-900\nWO-2026-901');
  ok('and the rows carry their numbers now',
     T.parseDefs(wrote[T.F.defsJson]).every(d => !!d.wo), wrote[T.F.defsJson]);
}
{
  airtableCalls = []; const seen = stubIntake();
  const out = await T.raiseDeficiencies('recRPT0000000001', recOf(null), [row({ photos: [CL + 'a.jpg'] })]);
  eq('the photo travels to intake', seen[0].body.deficiencies[0].photoUrls, [CL + 'a.jpg']);
  eq('and the row is marked delivered once the DMT acknowledges it',
     T.parseDefs(airtableCalls.at(-1).body.fields[T.F.defsJson])[0].photosSent, true);
  ok('the raise itself still worked', out.raised.length === 1);
}
{
  const seen = stubIntake();
  await T.raiseDeficiencies('recRPT0000000001', recOf(null), [row()]);
  ok('a row with no photo sends no photoUrls key at all',
     !('photoUrls' in seen[0].body.deficiencies[0]), JSON.stringify(seen[0].body.deficiencies[0]));
}
{
  /* ⚠️ The catch-up. A patroller on one bar raises the pothole immediately —
     the OMM clock is running — and the 4 MB picture lands minutes later. The
     row is sent AGAIN, and intake's existingWO() backfills the photo onto the
     same work order instead of raising a second one. */
  airtableCalls = []; const seen = stubIntake();
  const stored = JSON.stringify([T.cleanDef(row({ seq: 1, wo: 'WO-2026-0884' }))]);
  const out = await T.raiseDeficiencies('recRPT0000000001', recOf(stored),
    [row({ seq: 1, wo: 'WO-2026-0884', photos: [CL + 'late.jpg'] })]);
  eq('a row that is already raised IS re-sent when its photo arrives late',
     seen[0].body.deficiencies.map(d => d.deficiencyId), [RID + '-D01']);
  eq('carrying the photo', seen[0].body.deficiencies[0].photoUrls, [CL + 'late.jpg']);
  eq('and it keeps the work order number it already had',
     T.parseDefs(airtableCalls.at(-1).body.fields[T.F.defsJson])[0].wo, 'WO-2026-0884');
  eq('and is now marked delivered', T.parseDefs(airtableCalls.at(-1).body.fields[T.F.defsJson])[0].photosSent, true);
}
{
  /* ⚠️ If the DMT ever answered with a DIFFERENT number for a deficiency the
     report already holds one for, overwriting would throw away the reference
     the patroller has been shown and may have quoted on the radio. A
     disagreement is a signal, not a correction. */
  airtableCalls = []; stubIntake({ wo: 'WO-9999-9999' });
  await T.raiseDeficiencies('recRPT0000000001',
    recOf(JSON.stringify([T.cleanDef(row({ seq: 1, wo: 'WO-2026-0884' }))])),
    [row({ seq: 1, wo: 'WO-2026-0884', photos: [CL + 'a.jpg'] })]);
  eq('a number the report already holds is never replaced',
     T.parseDefs(airtableCalls.at(-1).body.fields[T.F.defsJson])[0].wo, 'WO-2026-0884');
}
{
  const seen = stubIntake();
  const stored = JSON.stringify([T.cleanDef(row({ seq: 1, wo: 'WO-1', photos: [CL + 'a.jpg'], photosSent: true }))]);
  await T.raiseDeficiencies('recRPT0000000001', recOf(stored),
    [row({ seq: 1, wo: 'WO-1', photos: [CL + 'a.jpg'], photosSent: true })]);
  eq('but once the DMT has them it is not sent again every save', seen.length, 0);
}
{
  /* ⚠️ Intake can answer for some rows and not others. Marking everything that
     was SENT as delivered — rather than everything that came BACK — would leave
     a photo permanently undelivered with nothing asking for it again. */
  airtableCalls = [];
  global.fetch = async (url, o) => ({ ok: true, status: 200, json: async () => ({ ok: true, results: [
    { workOrder: 'WO-2026-0900' },
    {},                                 // this one produced nothing
  ] }) });
  await T.raiseDeficiencies('recRPT0000000001', recOf(null),
    [row({ seq: 1, photos: [CL + 'a.jpg'] }), row({ seq: 2, photos: [CL + 'b.jpg'] })]);
  const back = T.parseDefs(airtableCalls.at(-1).body.fields[T.F.defsJson]);
  eq('the row the DMT answered for is marked delivered',
     back.filter(d => d.seq === 1)[0].photosSent, true);
  eq('and the one it did not is left to try again',
     back.filter(d => d.seq === 2)[0].photosSent, false);
}
{
  /* A failed send must leave the row asking. The alternative is a photo that
     silently never reaches the work order. */
  airtableCalls = []; stubIntake({ throws: 'ECONNRESET' });
  const out = await T.raiseDeficiencies('recRPT0000000001', recOf(null), [row({ photos: [CL + 'a.jpg'] })]);
  eq('a failed send marks nothing as delivered', out.raised, []);
  eq('and writes nothing', airtableCalls.length, 0);
}
{
  // 3 · a retry must not raise it twice
  airtableCalls = []; const seen = stubIntake();
  const stored = JSON.stringify([T.cleanDef(row({ seq: 1, wo: 'WO-2026-0884' }))]);
  const out = await T.raiseDeficiencies('recRPT0000000001', recOf(stored), [row({ seq: 1 }), row({ seq: 2 })]);
  eq('a row already raised is not sent again', seen[0].body.deficiencies.map(d => d.deficiencyId), [RID + '-D02']);
  eq('and only the new one comes back', out.raised.map(r => r.seq), [2]);
  eq('the old number is still on the report', T.parseDefs(airtableCalls.at(-1).body.fields[T.F.defsJson])
     .filter(d => d.seq === 1)[0].wo, 'WO-2026-0884');
}
{
  airtableCalls = []; const seen = stubIntake();
  const out = await T.raiseDeficiencies('recRPT0000000001', recOf(null), [row({ seq: 1, description: '' })]);
  eq('an unfinished row is not sent', seen.length, 0);
  eq('and nothing is written', airtableCalls.length, 0);
  eq('with a note saying why', out.note, 'nothing to raise');
}
{
  const seen = stubIntake();
  const out = await T.raiseDeficiencies('recRPT0000000001',
    { id: 'r', fields: { [T.F.patroller]: 'x' } }, [row()]);
  eq('without a Report ID nothing can be keyed, so nothing is sent', seen.length, 0);
  ok('and it says so', /Report ID/.test(out.note), out.note);
}
// 2 · a DMT outage must not cost the report
{
  airtableCalls = []; stubIntake({ throws: 'ECONNRESET' });
  const out = await T.raiseDeficiencies('recRPT0000000001', recOf(null), [row()]);
  eq('a dead connection raises nothing rather than throwing', out.raised, []);
  ok('and says the DMT could not be reached', /could not be reached/.test(out.note), out.note);
  eq('and writes nothing to the report', airtableCalls.length, 0);
}
{
  stubIntake({ notOk: true });
  const out = await T.raiseDeficiencies('recRPT0000000001', recOf(null), [row()]);
  eq('an intake error raises nothing rather than throwing', out.raised, []);
  ok('and says so', !!out.note, out.note);
}
{
  /* Intake answers positionally and its create path does not echo the id back,
     so position is the only thing to match on. A different count means the
     assumption is wrong, and guessing would put a work order number on the
     wrong pothole. */
  stubIntake({ results: 1 });
  const out = await T.raiseDeficiencies('recRPT0000000001', recOf(null), [row({ seq: 1 }), row({ seq: 2 })]);
  eq('a mismatched answer is not guessed at', out.raised, []);
  ok('and is called out as unexpected', /unexpected shape/.test(out.note), out.note);
}
{
  /* The work orders EXIST at this point. Losing their numbers here would mean
     raising them again, and only the deficiencyId stops that being duplicates. */
  airtableCalls = []; airtableFail = 'Airtable 503'; stubIntake();
  const out = await T.raiseDeficiencies('recRPT0000000001', recOf(null), [row()]);
  eq('a failed write-back still hands the numbers back', out.raised.map(r => r.workOrder), ['WO-2026-900']);
  ok('and says they are not recorded yet', /not yet recorded/.test(out.note), out.note);
  airtableFail = null;
}
{
  /* The DMT's own "is this already reported?" answer rides back on each intake
     result. Two patrollers pass the same washout and both log it: neither work
     order is wrong, but somebody should be told before a crew drives out twice.
     It is computed before the work order is written, so it never finds itself. */
  airtableCalls = [];
  global.fetch = async (url, o) => ({ ok: true, status: 200, json: async () => ({ ok: true, results: [
    { workOrder: 'WO-2026-0999', possibleDuplicates: [{ 'Work Order #': 'WO-2026-0884', metres: 50 }] },
  ] }) });
  const out = await T.raiseDeficiencies('recRPT0000000001', recOf(null), [row()]);
  eq('the new work order still comes back', out.raised[0].workOrder, 'WO-2026-0999');
  eq('with the one it may duplicate beside it', out.raised[0].duplicateOf, 'WO-2026-0884');
  eq('and that is recorded on the row',
     T.parseDefs(airtableCalls.at(-1).body.fields[T.F.defsJson])[0].dup, 'WO-2026-0884');
}
{
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true,
    results: [{ workOrder: 'WO-2026-0999', possibleDuplicates: [] }] }) });
  const out = await T.raiseDeficiencies('recRPT0000000001', recOf(null), [row()]);
  ok('with nothing nearby, no duplicate is claimed', !out.raised[0].duplicateOf,
     JSON.stringify(out.raised[0]));
}
{
  // A timeout has to exist, or one hung DMT request holds a serverless function
  // open until the platform kills it mid-shift.
  ok('the hand-off is bounded by an abort', /new AbortController\(\)/.test(SRC) && /ctl\.abort\(\)/.test(SRC));
  ok('with a timeout in the tens of seconds, not minutes',
     T.DMT_INTAKE_URL && /DMT_TIMEOUT_MS \|\| 12000/.test(SRC), SRC.match(/DMT_TIMEOUT_MS[^\n]*/));
  ok('and the timer is always cleared', /finally \{ clearTimeout\(timer\); \}/.test(SRC));
}
eq('the intake endpoint defaults to the DMT', T.DMT_INTAKE_URL, 'https://dmt.mrdc-htra.com/api/intake');

/* ══ 8 · the wiring in the handler ════════════════════════════════════════ */
ok('the flush is its own PATCH path, carrying no report fields',
   /if \(Array\.isArray\(body\.raiseDeficiencies\)\) \{[\s\S]{0,300}?return res\.status\(200\)/.test(SRC));
ok('it sits behind the ownership and status checks',
   SRC.indexOf('body.raiseDeficiencies') > SRC.indexOf('belongs to another patroller'));
ok('submit raises whatever is left, after validation not before',
   SRC.indexOf('const pend = mergeDefs') > SRC.indexOf('validateComplete(merged)'));
/* toFields would otherwise write the client's older view of the same rows
   straight over the numbers that were just recorded. */
ok('and the merged rows are what gets written',
   /\.\.\.\(mergedDefs \? \{ deficiencyRows: mergedDefs \} : \{\}\)/.test(SRC));
ok('the report email lists the work orders the shift raised',
   /Work orders raised/.test(SRC));

global.fetch = realFetch;
console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log('   FAIL  ' + f)); process.exitCode = 1; }
})();
