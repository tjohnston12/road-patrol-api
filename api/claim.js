/*
 * api/claim.js — the accident invoice for an MVA (road-patrol-api).
 * ---------------------------------------------------------------------------
 * Troy, 2026-10-30: "the invoice is the next thing to build into the process for the
 * patroller to complete". Modelled on the claims coordinator's real Accident Invoice
 * (2025-02-04-331 WB): Accident Site Response, Traffic Control, Asset Repair Costs,
 * Asset Material Costs, Markup on Third Party Costs, Administration, HST.
 *   · The patroller does it all (Troy's choice) — scene, traffic control, repair
 *     labour / equipment, materials and the third-party invoices (contractor, DOT…).
 *   · Hours come from the timesheets lines tagged to the MVA (the page reads
 *     employees.mrdc-htra.com/api/timesheets?view=mva) and from the accident report
 *     (arrived / left, the patrol truck, the items used). The patroller can add or adjust.
 *   · The invoice replaces the hand-filled Accident Claim Work Summary; it is the
 *     "Claim invoice" item of the accident file (mva.js FOLDER), ticked by Mark complete.
 *
 * Rates: Claim Rates (MVA base) — copied from the 2024 rate sheet. A line keeps the
 * rate it was added with, so a later rate change never alters an invoice already made.
 * Billed rate = Rate × (1 + Markup %).
 *
 * The math (worked in cents so the HST rounds the way the coordinator's sheet does):
 *   Site Response   = Σ site lines           Traffic Control = Σ traffic control lines
 *   Asset Repairs   = Σ repair lines + Σ third-party invoices (before HST)
 *   Materials       = Σ material lines (the billed rate already carries the 20% markup)
 *   Third Party Markup = 5% of the third-party invoices
 *   Administration  = 5% of (site + TC + repairs + materials), at least $150
 *   Subtotal, HST 15%, Total
 * Checked against 2025-02-04-331 WB: 95 + 12,533.13 + 4,848.28 → 869.07 / 873.82 /
 * 19,219.30 / 2,882.90 / 22,102.20.
 *
 *   GET  ?mva=rec…                                  invoice + rates + header + prefill
 *   POST {mva, action:'save', lines, third, notes}  save (un-completes it if it was complete)
 *   POST {mva, action:'file', filename, contentType, data}   a third-party invoice file
 *   POST {mva, action:'fileRemove', fileId}
 *   POST {mva, action:'complete', done}             Mark complete / reopen; ticks the folder
 * Who: anyone who can see the MVA file reads it; only the patroller while the file is
 * Open / Sent back, or an admin, changes it (mva.js canEdit) — the same rule as the folder.
 */
const L = require('./_lib');
const { requireCaller } = require('./_auth');
const M = require('./mva').lib;
const { arr, sel, airtable } = L;

const BASE = M.BASE;
const T_RATES = process.env.CLAIM_RATES_TABLE || 'tblWHinbvncbmvDzl';
const T_INV = process.env.CLAIM_INV_TABLE || 'tbluDkoE8Px4arkL8';
const T_AR = process.env.MVA_AR_TABLE || 'tblShwnpWGogKaZxG';
const R = { item: 'fldTncNpntgTi5uhL', cat: 'fldEZhO0Gdll912JM', part: 'fld4JoH8X0eTBjAdt', rate: 'fldR5L3RYOiLXh6HX',
  markup: 'fldQ3R8I6Ctn2A1WZ', unit: 'fldDWfuTzIVmMlbEN', active: 'fldW8cJfa7nV8lLsr' };
const I = { mvaNo: 'fldG5BvvnH14yGk7u', mva: 'fld1AL2ztQYNuwkbJ', lines: 'fld8EsoYxqpF1eOze', third: 'fldAUQKw0ADFCEEVi',
  files: 'fld93100j7kUUERJY', site: 'fldNp2nuQsRVWaj2j', tc: 'fldiGNJG5EQ6WVdgZ', repair: 'fldSMzdHIvTyavtp8',
  material: 'fldansbiyJAWdHbjW', markup: 'fldBRhI9H1iUnwbYm', admin: 'fldS1Yrnas60enxUS', subtotal: 'fld1BtKHVdQH6dExz',
  hst: 'fldQxiNKdSBPzikhO', total: 'fldquTkZmRQuMEHA2', complete: 'fldKtfJMGadw1suzI', completedBy: 'fld4WTEbSqs0NL9LU',
  completedAt: 'fldhnsAKP6cqkWVTq', notes: 'fldw4GebVHdhYXMiJ', updatedBy: 'fldVsKPuvCN3jbBnA', updatedAt: 'fldyUmMJRxzSa5aIh' };
// The accident report fields the invoice reads (api/accident.js A).
const A = { truck: 'fld0Ehu0B9iUAuktz', arrived: 'fldQyKBFIpkFzAiiP', left: 'fld8jizpsetNlXvY6', items: 'fldVkA60qvqGoK9Zk',
  driver: 'fldTskwroWMBDCjZq', owner: 'fldqH8sRqUBMt8fdS', driverIsOwner: 'fldD9VbHyw04cUmgH', trucking: 'fldwyd11uvJYY06hM',
  vehicle: 'fldZg4C3j0Ti6TkOT', plate: 'fld4cceVBAhLbaW9t', insurer: 'flduMRNGlarwbFjnT', policy: 'fld62DuTiuk1VsfJo',
  officer: 'fldNHYucsM2iU6YSG', policeFile: 'fld55lFenwTSFhmML', patroller: 'fldAIEl5C8asyAZzp', timeOfAccident: 'fldVOF5IkMZU132Af',
  damages: 'fldxgA24OZTG4QRSa', repairDate: 'fldJjoWcXy7ipWEXc' };

const ITEM = 'Claim invoice';                       // the accident file folder item (mva.js FOLDER)
const CATS = { site: 'Accident Site Response', tc: 'Traffic Control', repair: 'Asset Repair Costs', material: 'Asset Material Cost' };
const CAT_KEYS = Object.keys(CATS);
const SRC = ['timesheet', 'report', 'manual'];
const MARKUP_PCT = 5, ADMIN_PCT = 5, ADMIN_MIN_CENTS = 15000, HST_PCT = 15;
const MAX_LINES = 200, MAX_THIRD = 20;

const cents = n => Math.round(Number(n) * 100);
const dollars = c => Math.round(c) / 100;
const txt = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const KEY = /^[A-Za-z0-9:._\- ]{1,120}$/;

// ── rates ──────────────────────────────────────────────────────────────────
async function loadRates() {
  const out = []; let offset;
  do {
    const qs = new URLSearchParams(); qs.set('pageSize', '100'); qs.set('returnFieldsByFieldId', 'true');
    if (offset) qs.set('offset', offset);
    const page = await airtable(`${BASE}/${T_RATES}?${qs}`);
    for (const r of page.records || []) {
      const f = r.fields || {}, cat = CAT_KEYS.find(k => CATS[k] === sel(f[R.cat]));
      if (!cat || !f[R.item] || typeof f[R.rate] !== 'number') continue;
      const billed = dollars(cents(f[R.rate] * (1 + (Number(f[R.markup]) || 0))));
      out.push({ id: r.id, cat, item: f[R.item], part: f[R.part] || '', unit: f[R.unit] || '', base: f[R.rate],
        markup: Number(f[R.markup]) || 0, rate: billed, active: !!f[R.active] });
    }
    offset = page.offset;
  } while (offset);
  return out;
}
const findRate = (rates, cat, item) => rates.find(r => r.active && r.cat === cat && r.item === item);

// ── the invoice row ────────────────────────────────────────────────────────
async function invoiceRec(mvaNo) {
  const qs = new URLSearchParams(); qs.set('returnFieldsByFieldId', 'true'); qs.set('maxRecords', '1');
  qs.set('filterByFormula', `{MVA No.}='${String(mvaNo).replace(/'/g, "\\'")}'`);
  return ((await airtable(`${BASE}/${T_INV}?${qs}`)).records || [])[0] || null;
}
const parseJson = (s, d) => { try { const v = JSON.parse(s || ''); return Array.isArray(v) ? v : d; } catch (_) { return d; } };
function shapeInvoice(rec) {
  const f = (rec && rec.fields) || {};
  const lines = parseJson(f[I.lines], []), third = parseJson(f[I.third], []);
  return { id: rec ? rec.id : null, lines, third, notes: f[I.notes] || '',
    files: arr(f[I.files]).map(a => ({ id: a.id, url: a.url, filename: a.filename, type: a.type || '', size: a.size || 0 })),
    totals: totalsOf(lines, third), complete: !!f[I.complete], completedBy: f[I.completedBy] || '', completedAt: f[I.completedAt] || '',
    updatedBy: f[I.updatedBy] || '', updatedAt: f[I.updatedAt] || '' };
}

// ── totals ─────────────────────────────────────────────────────────────────
const lineCents = l => (l.rateId && Number(l.qty) > 0 ? Math.round(Number(l.qty) * cents(l.rate)) : 0);
function totalsOf(lines, third) {
  const by = { site: 0, tc: 0, repair: 0, material: 0 };
  for (const l of lines || []) if (by[l.cat] !== undefined) by[l.cat] += lineCents(l);
  const thirdC = (third || []).reduce((t, x) => t + cents(Number(x.amount) || 0), 0);
  const repairC = by.repair + thirdC;
  const markupC = Math.round(thirdC * MARKUP_PCT / 100);
  const baseC = by.site + by.tc + repairC + by.material;
  const adminC = baseC > 0 ? Math.max(Math.round(baseC * ADMIN_PCT / 100), ADMIN_MIN_CENTS) : 0;
  const subC = baseC + markupC + adminC, hstC = Math.round(subC * HST_PCT / 100);
  return { site: dollars(by.site), tc: dollars(by.tc), repairLines: dollars(by.repair), third: dollars(thirdC), repair: dollars(repairC),
    material: dollars(by.material), markup: dollars(markupC), admin: dollars(adminC), subtotal: dollars(subC), hst: dollars(hstC),
    total: dollars(subC + hstC), rules: { markupPct: MARKUP_PCT, adminPct: ADMIN_PCT, adminMin: dollars(ADMIN_MIN_CENTS), hstPct: HST_PCT } };
}

// ── cleaning what the page sends ───────────────────────────────────────────
/* A line keeps the rate it was saved with while its rate item is unchanged; a new or
   changed line takes today's rate. A line with no rate item yet (a unit from the
   timesheets whose equipment type is still to pick) is kept at $0 and blocks Mark complete. */
function cleanLines(input, saved, rates) {
  if (!Array.isArray(input)) return { error: 'lines must be a list' };
  if (input.length > MAX_LINES) return { error: `At most ${MAX_LINES} lines` };
  const before = {}; for (const l of saved || []) before[l.key] = l;
  const out = [], seen = new Set();
  for (let i = 0; i < input.length; i++) {
    const x = input[i] || {}, n = i + 1;
    const key = txt(x.key, 120);
    if (!KEY.test(key)) return { error: `Line ${n}: bad key` };
    if (seen.has(key)) return { error: `Line ${n}: repeated` };
    seen.add(key);
    if (!CAT_KEYS.includes(x.cat)) return { error: `Line ${n}: which part of the invoice?` };
    const qty = x.qty === '' || x.qty == null ? null : Number(x.qty);
    if (qty != null && !(qty > 0 && qty <= 10000)) return { error: `Line ${n}: the quantity must be more than 0` };
    const line = { key, cat: x.cat, qty: qty == null ? null : Math.round(qty * 100) / 100, who: txt(x.who, 120), date: /^\d{4}-\d{2}-\d{2}$/.test(String(x.date || '')) ? x.date : '',
      note: txt(x.note, 300), src: SRC.includes(x.src) ? x.src : 'manual', label: txt(x.label, 120), rateId: '', item: '', unit: '', rate: 0, part: '' };
    const rateId = txt(x.rateId, 20);
    if (rateId) {
      const was = before[key];
      if (was && was.rateId === rateId) Object.assign(line, { rateId, item: was.item, unit: was.unit, rate: was.rate, part: was.part || '' });
      else {
        const r = rates.find(y => y.id === rateId && y.active);
        if (!r) return { error: `Line ${n}: that rate is not on the rate sheet` };
        if (r.cat !== x.cat) return { error: `Line ${n}: "${r.item}" belongs under ${CATS[r.cat]}` };
        Object.assign(line, { rateId, item: r.item, unit: r.unit, rate: r.rate, part: r.part });
      }
    }
    out.push(line);
  }
  return { lines: out };
}
function cleanThird(input) {
  if (!Array.isArray(input)) return { error: 'third must be a list' };
  if (input.length > MAX_THIRD) return { error: `At most ${MAX_THIRD} third-party invoices` };
  const out = [], seen = new Set();
  for (let i = 0; i < input.length; i++) {
    const x = input[i] || {}, n = i + 1, key = txt(x.key, 120);
    if (!KEY.test(key) || seen.has(key)) return { error: `Third-party invoice ${n}: bad key` };
    seen.add(key);
    const amount = x.amount === '' || x.amount == null ? null : Number(x.amount);
    if (amount != null && !(amount > 0 && amount < 10000000)) return { error: `Third-party invoice ${n}: the amount must be more than 0` };
    out.push({ key, vendor: txt(x.vendor, 120), invoiceNo: txt(x.invoiceNo, 60), amount: amount == null ? null : Math.round(amount * 100) / 100,
      note: txt(x.note, 300) });
  }
  return { third: out };
}
/* What stops Mark complete. */
function missingFor(inv) {
  const m = [];
  if (!inv.lines.length && !inv.third.length) m.push('Nothing on the invoice yet');
  inv.lines.forEach((l, i) => {
    const name = l.item || l.label || 'Line ' + (i + 1);
    if (!l.rateId) m.push(`${name}${l.who ? ' (' + l.who + ')' : ''}: pick what it was from the rate sheet`);
    else if (!(l.qty > 0)) m.push(`${name}${l.who ? ' (' + l.who + ')' : ''}: hours / quantity`);
  });
  inv.third.forEach((t, i) => {
    if (!t.vendor) m.push(`Third-party invoice ${i + 1}: who it is from`);
    if (!(t.amount > 0)) m.push(`Third-party invoice ${i + 1}${t.vendor ? ' (' + t.vendor + ')' : ''}: the amount before HST`);
  });
  if (inv.third.length && !inv.files.length) m.push('Attach the third-party invoice(s)');
  return m;
}

// ── the header and the starting lines, from the MVA and its accident report ─
async function reportFor(mvaNo) {
  const qs = new URLSearchParams(); qs.set('returnFieldsByFieldId', 'true'); qs.set('maxRecords', '1');
  qs.set('filterByFormula', `{Report No.}='${String(mvaNo + '-AR').replace(/'/g, "\\'")}'`);
  const rec = ((await airtable(`${BASE}/${T_AR}?${qs}`)).records || [])[0];
  return rec ? rec.fields || {} : null;
}
function headerOf(row, ar) {
  const a = ar || {};
  const owner = a[A.driverIsOwner] ? a[A.driver] : (a[A.owner] || a[A.trucking] || '');
  return { mvaNo: row.mvaNo, date: row.date || '', route: row.route || '', km: row.km, direction: row.direction || '', division: row.division || '',
    patroller: a[A.patroller] || row.patroller || '', driver: a[A.driver] || '', owner: owner || '', trucking: a[A.trucking] || '',
    vehicle: a[A.vehicle] || '', plate: a[A.plate] || '', insurer: a[A.insurer] || '', policy: a[A.policy] || '',
    officer: a[A.officer] || '', policeFile: a[A.policeFile] || row.policeFile || '', claimNo: row.claimNo || '',
    filedInsurer: row.filedInsurer || '', damages: a[A.damages] || row.damageDesc || '', repairDate: a[A.repairDate] || '',
    hasReport: !!ar };
}
/* Starting lines from the accident report: the patroller's time at the scene (arrived →
   left, at least 1 h, rounded up to the half hour), their truck, and the billable items. */
const ITEM_RATES = { 'First Aid Kit': ['site', 'First Aid Kit'], 'Fire Extinguisher': ['site', 'Fire Extinguisher'],
  'Spill Kit': ['material', 'Spill Kit / Disposal Fee'], 'Signs': ['tc', 'Cones/Barrels/Signs'] };
function sceneHours(ar) {
  const a = Date.parse(ar && ar[A.arrived]), b = Date.parse(ar && ar[A.left]);
  if (!(a > 0 && b > a)) return null;
  return Math.max(1, Math.ceil((b - a) / 1800000) / 2);
}
function prefillFrom(row, ar, rates) {
  if (!ar) return [];
  const out = [], h = sceneHours(ar), who = ar[A.patroller] || row.patroller || '';
  const add = (key, cat, item, qty, extra) => {
    const r = findRate(rates, cat, item);
    out.push(Object.assign({ key, cat, qty, who: '', src: 'report', rateId: r ? r.id : '', item: r ? r.item : '', unit: r ? r.unit : '', rate: r ? r.rate : 0, label: item }, extra || {}));
  };
  const note = h == null ? 'Arrived / left are not on the accident report — enter the hours' : 'From the accident report (arrived → left)';
  add('ar:labour', 'site', 'Labour', h, { who, note });
  add('ar:truck', 'site', 'Patrol Vehicle/Pick Up Truck', h, { who: ar[A.truck] ? 'Unit ' + ar[A.truck] : '', note });
  for (const it of arr(ar[A.items]).map(sel)) {
    const m = ITEM_RATES[it]; if (m) add('ar:item:' + it, m[0], m[1], 1, { note: 'Items used at the scene (accident report)' });
  }
  return out;
}

// ── the handler ────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (L.cors(req, res)) return;
  if (!L.PAT) return res.status(500).json({ error: 'Server not configured (AIRTABLE_PAT missing)' });
  const caller = await requireCaller(req, res);
  if (!caller) return;
  try {
    const body = req.method === 'POST' ? L.parseBody(req) : {};
    const id = req.method === 'GET' ? req.query?.mva : body.mva;
    const row = await M.loadOwned(id, caller);
    if (!row) return res.status(404).json(M.NOT_FOUND);
    const edit = M.canEdit(row);
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'GET') {
      const [rates, rec, ar] = await Promise.all([loadRates(), invoiceRec(row.mvaNo), reportFor(row.mvaNo).catch(() => null)]);
      const inv = shapeInvoice(rec);
      return res.status(200).json({ mva: { id: row.id, mvaNo: row.mvaNo, stage: row.stage, patroller: row.patroller },
        invoice: inv, missing: missingFor(inv), rates: rates.filter(r => r.active), cats: CATS, header: headerOf(row, ar),
        prefill: prefillFrom(row, ar, rates), edit, admin: !!caller.isAdmin });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!edit) return res.status(409).json({ error: row.access && row.access.own
      ? 'The accident file has been submitted (' + row.stage + ') — the invoice can only be changed if it is sent back to you.'
      : 'Only the patroller completes the invoice — send the file back with a note if something is wrong.' });

    const now = new Date().toISOString(), who = caller.name || '';
    let rec = await invoiceRec(row.mvaNo);
    const ensure = async () => rec || (rec = await airtable(`${BASE}/${T_INV}`, { method: 'POST', body: JSON.stringify({ returnFieldsByFieldId: true,
      fields: { [I.mvaNo]: row.mvaNo, [I.mva]: [row.id], [I.lines]: '[]', [I.third]: '[]', [I.updatedBy]: who, [I.updatedAt]: now } }) }));
    const patch = fields => airtable(`${BASE}/${T_INV}/${rec.id}`, { method: 'PATCH', body: JSON.stringify({ returnFieldsByFieldId: true, fields }) });
    const totalsFields = t => ({ [I.site]: t.site, [I.tc]: t.tc, [I.repair]: t.repair, [I.material]: t.material, [I.markup]: t.markup,
      [I.admin]: t.admin, [I.subtotal]: t.subtotal, [I.hst]: t.hst, [I.total]: t.total });
    // Any change after Mark complete reopens it: the folder item is unticked until it is marked again.
    const reopen = async () => {
      if (!(rec && rec.fields && rec.fields[I.complete])) return {};
      await M.upsertItem(row, ITEM, { [M.FF.done]: false, [M.FF.doneBy]: '', [M.FF.doneAt]: null, [M.FF.updatedBy]: who, [M.FF.updatedAt]: now });
      return { [I.complete]: false, [I.completedBy]: '', [I.completedAt]: null };
    };
    const answer = async () => {
      const inv = shapeInvoice(await invoiceRec(row.mvaNo));
      return res.status(200).json({ invoice: inv, missing: missingFor(inv) });
    };

    if (body.action === 'save') {
      const rates = await loadRates();
      const saved = shapeInvoice(rec);
      const cl = cleanLines(body.lines, saved.lines, rates); if (cl.error) return res.status(400).json({ error: cl.error });
      const ct = cleanThird(body.third); if (ct.error) return res.status(400).json({ error: ct.error });
      await ensure();
      const f = Object.assign(await reopen(), { [I.lines]: JSON.stringify(cl.lines), [I.third]: JSON.stringify(ct.third),
        [I.updatedBy]: who, [I.updatedAt]: now }, totalsFields(totalsOf(cl.lines, ct.third)));
      if (body.notes !== undefined) f[I.notes] = txt(body.notes, 5000);
      rec = await patch(f);
      return answer();
    }
    if (body.action === 'file') {
      if (!body.data) return res.status(400).json({ error: 'data (base64) is required' });
      await ensure();
      await L.uploadAttachment({ base: BASE, recordId: rec.id, fieldId: I.files, filename: body.filename, contentType: body.contentType, data: body.data });
      await patch(Object.assign(await reopen(), { [I.updatedBy]: who, [I.updatedAt]: now }));
      return answer();
    }
    if (body.action === 'fileRemove') {
      if (!rec) return res.status(404).json({ error: 'File not found' });
      const keep = arr((rec.fields || {})[I.files]).filter(a => a.id !== body.fileId).map(a => ({ id: a.id }));
      await patch(Object.assign(await reopen(), { [I.files]: keep, [I.updatedBy]: who, [I.updatedAt]: now }));
      return answer();
    }
    if (body.action === 'complete') {
      if (body.done === false) {
        if (rec) await patch(Object.assign(await reopen(), { [I.updatedBy]: who, [I.updatedAt]: now }));
        return answer();
      }
      const inv = shapeInvoice(rec);
      const missing = missingFor(inv);
      if (missing.length) return res.status(409).json({ error: 'Not ready: ' + missing.join('; '), missing });
      rec = await patch(Object.assign({ [I.complete]: true, [I.completedBy]: who, [I.completedAt]: now, [I.updatedBy]: who, [I.updatedAt]: now },
        totalsFields(inv.totals)));
      await M.upsertItem(row, ITEM, { [M.FF.done]: true, [M.FF.doneBy]: who, [M.FF.doneAt]: now, [M.FF.updatedBy]: who, [M.FF.updatedAt]: now,
        [M.FF.notes]: `Total $${inv.totals.total.toFixed(2)} (subtotal $${inv.totals.subtotal.toFixed(2)} + HST $${inv.totals.hst.toFixed(2)})` });
      return answer();
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('claim error:', e);
    return res.status(e.status && e.status < 500 ? e.status : 500).json({ error: e.message || 'Server error' });
  }
};
module.exports._test = { totalsOf, cleanLines, cleanThird, missingFor, prefillFrom, sceneHours, headerOf, ITEM };
