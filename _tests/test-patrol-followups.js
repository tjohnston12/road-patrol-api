// test-patrol-followups.js — run with an ABSOLUTE path:
//   node <repo>/road-patrol-api/_tests/test-patrol-followups.js
// Zero dependencies; no network.
//
// Troy, 2026-10-20: on the daily patrol report's shift checks, a Yes shows a second line —
// Deficiencies / Illumination / Pavement markings / Road sign / ET stickers: "Entered into
// DMT" and "More than one entry"; Travel advisory: Issued and Lifted; SNIC: nothing.
// Pinned here: the field ids, what toFields writes (and clears under a No), the summer rule
// for the advisory pair, what shape() reads back, and the email lines.
'use strict';
const path = require('path');
const T = require(path.join(__dirname, '..', 'api', 'patrol.js')).__test;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('   FAIL ', n, x === undefined ? '' : '— ' + String(x).slice(0, 300)); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), `got ${JSON.stringify(g)} want ${JSON.stringify(w)}`);
const { F, FOLLOW, FOLLOW_KEYS, toFields, shape, reportHtml } = T;

eq('the six checks with a second line (not SNIC)', Object.keys(FOLLOW), ['deficiencies', 'advisory', 'illumination', 'markings', 'reflectivity', 'etStickers']);
ok('SNIC has none', !FOLLOW.snic);
eq('OMM deficiencies: DMT + more than one', FOLLOW.deficiencies.map(x => x[1]), ['Entered into DMT', 'More than one entry']);
// Troy, 2026-10-22: the four inspection checks ask "Deficiencies found" first.
eq('the four inspection checks: Deficiencies found, then DMT + more than one', ['illumination', 'markings', 'reflectivity', 'etStickers'].map(k => FOLLOW[k].map(x => x[1])),
  Array(4).fill(['Deficiencies found', 'Entered into DMT', 'More than one entry']));
eq('advisory: Issued and Lifted', FOLLOW.advisory.map(x => x[1]), ['Issued', 'Lifted']);
eq('16 follow-up keys', FOLLOW_KEYS.length, 16);
ok('each has its own Airtable field id', FOLLOW_KEYS.every(k => /^fld[A-Za-z0-9]{14}$/.test(F[k])) && new Set(FOLLOW_KEYS.map(k => F[k])).size === 16);
eq('…the four new ones', ['illuminationFound', 'markingsFound', 'reflectivityFound', 'etStickersFound'].map(k => F[k]),
  ['fldvCDQLM1LUBQnHG', 'fldvEX2GJ1VMwkfv7', 'fldnIZPbkwmCuB13B', 'fld2qfrZG2EPBkD32']);
ok('…none reuses an existing field', !FOLLOW_KEYS.some(k => Object.keys(F).filter(x => !FOLLOW_KEYS.includes(x)).some(x => F[x] === F[k])));

const W = { season: 'Winter', depot: 'Oromocto', routes: [] };
const S = { season: 'Summer', division: 'Western', routes: [] };
{
  const f = toFields({ ...W, deficiencies: true, deficienciesDmt: true, deficienciesMultiple: false, advisory: true, advisoryIssued: true, advisoryLifted: true,
    illumination: true, illuminationMultiple: true });
  eq('a Yes writes the ticks sent', [f[F.deficienciesDmt], f[F.deficienciesMultiple], f[F.advisoryIssued], f[F.advisoryLifted], f[F.illuminationMultiple]], [true, false, true, true, true]);
  ok('…and leaves the unsent ones alone (a draft save does not clear them)', !(F.illuminationDmt in f) && !(F.markingsDmt in f));
}
{
  const f = toFields({ ...W, illumination: false, illuminationDmt: true, illuminationMultiple: true, advisory: false, advisoryIssued: true });
  eq('a No clears its follow-ups whatever was sent', [f[F.illuminationDmt], f[F.illuminationMultiple], f[F.advisoryIssued], f[F.advisoryLifted]], [false, false, false, false]);
}
{
  const f = toFields({ ...S, advisory: true, advisoryIssued: true, advisoryLifted: true, etStickers: true, etStickersDmt: true });
  ok('summer: the travel advisory pair is never written', !(F.advisoryIssued in f) && !(F.advisoryLifted in f));
  eq('summer: the others are', f[F.etStickersDmt], true);
}
{
  const rec = { id: 'recX', fields: { [F.reportId]: 'RP-1', [F.season]: { name: 'Winter' }, [F.deficiencies]: true, [F.deficienciesDmt]: true,
    [F.advisory]: true, [F.advisoryLifted]: true, [F.markings]: true } };
  const row = shape(rec);
  eq('shape reads them back', [row.deficienciesDmt, row.deficienciesMultiple, row.advisoryIssued, row.advisoryLifted, row.markingsDmt], [true, false, false, true, false]);
  const html = reportHtml(Object.assign(row, { shiftDate: '2026-12-01', depot: 'Oromocto', routes: [] }));
  ok('email: the ticked follow-up under its check', /OMM deficiencies entered<div[^>]*>Entered into DMT<\/div>/.test(html), html.slice(html.indexOf('Shift checks'), html.indexOf('Shift checks') + 600));
  ok('email: advisory shows Lifted', /Travel advisory issued \/ lifted<div[^>]*>Lifted<\/div>/.test(html));
  ok('email: nothing under a Yes with no ticks', /Pavement markings checked<\/td>/.test(html));
  const sum = reportHtml(Object.assign(shape({ id: 'r', fields: { [F.season]: { name: 'Summer' }, [F.illumination]: false, [F.illuminationDmt]: true } }), { routes: [] }));
  ok('email: nothing under a No even if a box was left ticked', /Highway illumination inspection<\/td>/.test(sum));
}

{
  const f = toFields({ ...S, illumination: true, illuminationFound: false, illuminationDmt: true, illuminationMultiple: true });
  eq('illumination Yes, no deficiencies found: the DMT ticks are cleared whatever was sent', [f[F.illuminationFound], f[F.illuminationDmt], f[F.illuminationMultiple]], [false, false, false]);
  const g = toFields({ ...S, markings: true, markingsFound: true, markingsDmt: true });
  eq('deficiencies found: the DMT tick is written', [g[F.markingsFound], g[F.markingsDmt]], [true, true]);
  const h = toFields({ ...S, deficiencies: true, deficienciesDmt: true });
  eq('OMM deficiencies is unchanged (no Found box)', h[F.deficienciesDmt], true);
  const row = shape({ id: 'r', fields: { [F.season]: { name: 'Summer' }, [F.illumination]: true, [F.illuminationFound]: true, [F.illuminationDmt]: true } });
  const html = reportHtml(Object.assign(row, { routes: [] }));
  ok('email: "Deficiencies found · Entered into DMT" under illumination', /Highway illumination inspection[^<]*<div[^>]*>Deficiencies found · Entered into DMT<\/div>/.test(html), html.slice(html.indexOf('illumination') - 20, html.indexOf('illumination') + 200));
}

console.log(`\n  test-patrol-followups: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
