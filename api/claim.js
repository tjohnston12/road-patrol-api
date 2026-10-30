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
 *
 * The Claims Manager (Troy, 2026-10-30: "jay can print claim and email manually or email
 * directly. Jay may also have some paperwork to attach"), once the file is verified (With claims,
 * Filed with insurance, Paid), or an admin:
 *   POST {mva, action:'paperwork', filename, contentType, data}   his own documents (Claims Paperwork)
 *   POST {mva, action:'paperworkRemove', fileId}
 *   POST {mva, action:'email', to, cc, message, insurer, claimNo, photos, markFiled}
 *     emails the claim: the invoice in the body; the third-party invoices, his paperwork and (if
 *     asked) the accident / repair photos attached. Reply-to and cc him. Through the Patrol
 *     Notifications switch "MVA file workflow" (Owner test sends it to the Owner only). With
 *     markFiled, a file still With claims is recorded Filed with insurance (insurer, claim no.,
 *     today). Each send is written to the Email Log.
 */
const L = require('./_lib');
const C = require('./_conditions');   // the Patrol Notifications switch (Off / Owner test / Everyone)
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
  completedAt: 'fldhnsAKP6cqkWVTq', notes: 'fldw4GebVHdhYXMiJ', updatedBy: 'fldVsKPuvCN3jbBnA', updatedAt: 'fldyUmMJRxzSa5aIh',
  paperwork: 'fldoSDX2PNWtFnigT', emailLog: 'fldkVGhMVKDUhAHvp' };
const CLAIMS_STAGES = ['With claims', 'Awaiting approval', 'Filed with insurance', 'Paid'];
const EMAIL_STAGES = ['With claims', 'Awaiting approval', 'Filed with insurance'];
const WORKFLOW_SWITCH = 'MVA file workflow';
const CLAIMS_FROM = process.env.CLAIMS_FROM || process.env.MVA_FROM || 'MRDC Operations Corporation <noreply@mrdc-htra.com>';
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[A-Za-z]{2,}$/;
const MAX_ATTACH_BYTES = 30 * 1024 * 1024;   // Resend takes 40 MB a message; leave room for the body
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
    paperwork: arr(f[I.paperwork]).map(a => ({ id: a.id, url: a.url, filename: a.filename, type: a.type || '', size: a.size || 0 })),
    emailLog: f[I.emailLog] || '',
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

// ── the claim as an email (the claims coordinator's Accident Invoice layout) ───
const e = v => L.esc(v == null ? '' : String(v)).replace(/"/g, '&quot;');
const money = n => '$' + (Number(n) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Moncton', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function invoiceHtml(h, inv, o) {
  o = o || {};
  const t = inv.totals, td = 'border:1px solid #333;padding:4px 6px;vertical-align:top', th = td + ';background:#eee;text-align:left';
  const r = ';text-align:right';
  const km = h.km != null && h.km !== '' ? Number(h.km).toFixed(3) : '';
  const rows = list => list.map(x => `<tr><td style="${td};width:38%">${e(x[0])}</td><td style="${td}">${e(x[1])}</td></tr>`).join('');
  const sec = (cat, title) => {
    const ls = inv.lines.filter(l => l.cat === cat && l.rateId);
    if (!ls.length && !(cat === 'repair' && inv.third.length)) return '';
    return `<table style="border-collapse:collapse;width:100%;margin:10px 0"><tr><th style="${th}" colspan="5">${e(title)}</th></tr>` +
      `<tr><th style="${th}">Expense description</th><th style="${th}">Who / unit</th><th style="${th}${r}">Rate</th><th style="${th}${r}">Hours / items</th><th style="${th}${r}">Cost</th></tr>` +
      ls.map(l => `<tr><td style="${td}">${e(l.item)}${l.part ? ' (' + e(l.part) + ')' : ''}</td><td style="${td}">${e(l.who)}${l.date ? ' ' + e(l.date) : ''}</td><td style="${td}${r}">${money(l.rate)}</td><td style="${td}${r}">${e(l.qty)}</td><td style="${td}${r}">${money(lineCents(l) / 100)}</td></tr>`).join('') +
      (cat === 'repair' ? inv.third.map(x => `<tr><td style="${td}" colspan="4">${e(x.vendor)}${x.invoiceNo ? ' (Inv# ' + e(x.invoiceNo) + ')' : ''}${x.note ? ' — ' + e(x.note) : ''}</td><td style="${td}${r}">${money(x.amount)}</td></tr>`).join('') : '') +
      `<tr><td style="${td}${r}" colspan="4"><b>Total</b></td><td style="${td}${r}"><b>${money(cat === 'repair' ? t.repair : t[cat])}</b></td></tr></table>`;
  };
  return `<div style="font-family:Georgia,'Times New Roman',serif;color:#000;max-width:720px;font-size:14px">
  <table style="border-collapse:collapse;width:100%"><tr><td style="${td};width:30%"><b>MRDC</b><br>Operations Corporation</td>
    <td style="${td};text-align:center;font-size:20px"><b>ACCIDENT INVOICE</b></td>
    <td style="${td};width:30%;font-size:12px">203 Black Watch Avenue<br>Oromocto, NB E2V 4L7<br>Phone: 506 357-1240<br>Fax: 506 357-1250</td></tr></table>
  <table style="border-collapse:collapse;width:100%;margin-top:8px">${rows([['Date', o.date || today()], ['Invoice No.', h.mvaNo], ['Policy No.', h.policy], ['Claim No.', o.claimNo || h.claimNo]])}</table>
  <table style="border-collapse:collapse;width:100%;margin-top:8px"><tr><th style="${th}" colspan="2">Invoice To:</th></tr>${rows([['Insurer', o.insurer || h.filedInsurer || h.insurer]])}</table>
  <table style="border-collapse:collapse;width:100%;margin-top:8px"><tr><th style="${th}" colspan="2">Accident Data:</th></tr>${rows([['Date of Incident', h.date], ['Driver', h.driver],
    ['Vehicle Owner', h.owner], ['Vehicle Type', h.vehicle], ['License Plate No.', h.plate], ['Incident Location', h.route], ['KM Marker', (km + ' ' + (h.direction || '')).trim()],
    ['Police Officer\'s Name', h.officer], ['Police File No.', h.policeFile]])}</table>
  <table style="border-collapse:collapse;width:100%;margin-top:8px"><tr><th style="${th}">MRDC Accident and Repair Costs</th><th style="${th}${r}">Amount</th></tr>` +
    [['Accident Site Response', t.site], ['Traffic Control', t.tc], ['Asset Repair Costs', t.repair], ['Asset Material Costs', t.material], ['Markup on Third Party Costs', t.markup],
     ['Administration', t.admin], ['Subtotal', t.subtotal], ['HST @ 15%', t.hst]].map(x => `<tr><td style="${td}">${e(x[0])}</td><td style="${td}${r}">${money(x[1])}</td></tr>`).join('') +
    `<tr><td style="${td}"><b>Total</b></td><td style="${td}${r}"><b>${money(t.total)}</b></td></tr></table>
  <p style="font-size:12px">HST No: 872059894RT0001. Canada Revenue Agency GST/HST Ruling — June 26, 2009, Case Number 114777: MRDC Operations Corporation is required to collect HST on amounts invoiced to third parties in respect of traffic control services and rehabilitation of the Facility pursuant to section 165.
  Terms of payment: remittance is due within 20 days from receipt of this invoice. Interest charges of 2% per month (26.2% annually) will be charged on overdue accounts.</p>` +
    sec('site', 'Accident Site Response (time of accident)') + sec('tc', 'Traffic Control') + sec('repair', 'Asset Repair Costs') + sec('material', 'Asset Material Costs') +
    (inv.notes ? `<table style="border-collapse:collapse;width:100%;margin:10px 0"><tr><th style="${th}">Facility Repairs</th></tr><tr><td style="${td}">${e(inv.notes).replace(/\n/g, '<br>')}</td></tr></table>` : '') +
  `</div>`;
}
const emails = v => [...new Set(String(v || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean))];
const stampLine = (who, what) => `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Moncton', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(',', '')} — ${who || '?'} — ${what}`;
/* What goes with the email: the third-party invoices, the claims paperwork and (if asked) the photos
   in the file. Each by URL (Resend fetches it). Stops before the size limit and says what was left out. */
function attachmentsFor(inv, photos) {
  const out = [], left = []; let bytes = 0;
  const add = (list, tag) => list.forEach(a => {
    if (!a.url) return;
    const size = Number(a.size) || 0;
    if (bytes + size > MAX_ATTACH_BYTES) { left.push(a.filename || tag); return; }
    bytes += size; out.push({ filename: a.filename || tag, path: a.url });
  });
  add(inv.files, 'invoice'); add(inv.paperwork, 'paperwork'); add(photos || [], 'photo.jpg');
  return { list: out, left, bytes };
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
        prefill: prefillFrom(row, ar, rates), edit, admin: !!caller.isAdmin,
        claims: claimsFor(row, caller) ? { email: EMAIL_STAGES.includes(row.stage), filed: row.stage !== 'With claims' && row.stage !== 'Awaiting approval',
          insurer: row.filedInsurer || '', claimNo: row.claimNo || '' } : null });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (['paperwork', 'paperworkRemove', 'email'].includes(body.action)) return claimsAction(row, body, caller, res);
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
/* The Claims Manager's part (Troy, 2026-10-30). */
const claimsFor = (row, caller) => !!(row && CLAIMS_STAGES.includes(row.stage) && ((row.access && row.access.claims) || caller.isAdmin));
async function claimsAction(row, body, caller, res) {
  if (!claimsFor(row, caller)) return res.status(row.access && (row.access.claims || caller.isAdmin) ? 409 : 403).json({ error: CLAIMS_STAGES.includes(row.stage)
    ? 'Only the Claims Manager handles the claim.' : 'The claim goes to the Claims Manager once the file is verified (' + row.stage + ').' });
  const now = new Date().toISOString(), who = caller.name || '';
  let rec = await invoiceRec(row.mvaNo);
  if (!rec) return res.status(409).json({ error: 'There is no invoice on this file yet.' });
  const patch = fields => airtable(`${BASE}/${T_INV}/${rec.id}`, { method: 'PATCH', body: JSON.stringify({ returnFieldsByFieldId: true, fields }) });
  const answer = async extra => res.status(200).json(Object.assign({ invoice: shapeInvoice(await invoiceRec(row.mvaNo)) }, extra || {}));
  if (body.action === 'paperwork') {
    if (!body.data) return res.status(400).json({ error: 'data (base64) is required' });
    await L.uploadAttachment({ base: BASE, recordId: rec.id, fieldId: I.paperwork, filename: body.filename, contentType: body.contentType, data: body.data });
    return answer();
  }
  if (body.action === 'paperworkRemove') {
    const keep = arr((rec.fields || {})[I.paperwork]).filter(a => a.id !== body.fileId).map(a => ({ id: a.id }));
    await patch({ [I.paperwork]: keep });
    return answer();
  }
  // email
  if (!EMAIL_STAGES.includes(row.stage)) return res.status(409).json({ error: 'The claim has been paid — nothing more to send.' });
  const to = emails(body.to), cc0 = emails(body.cc);
  if (!to.length) return res.status(400).json({ error: 'Who should it go to? Enter the insurance company\'s email address.' });
  const bad = [...to, ...cc0].filter(x => !EMAIL_RE.test(x));
  if (bad.length) return res.status(400).json({ error: 'Not an email address: ' + bad.join(', ') });
  if (to.length + cc0.length > 10) return res.status(400).json({ error: 'At most 10 addresses.' });
  const insurer = txt(body.insurer, 200), claimNo = txt(body.claimNo, 100);
  if (body.markFiled && !insurer) return res.status(400).json({ error: 'The insurance company is needed to record it as filed.' });
  const inv = shapeInvoice(rec);
  if (!inv.complete) return res.status(409).json({ error: 'The invoice is not marked complete.' });
  const t = await M.team({}), mine = t.emailOf(who);
  const ar = await reportFor(row.mvaNo).catch(() => null);
  const h = headerOf(row, ar);
  let photos = [];
  if (body.photos) { try { photos = ((await M.photosFor(row)).list || []).map(p => ({ url: p.url, filename: p.filename || (p.source + '.jpg'), size: p.size || 0 })); } catch (_) { photos = []; } }
  const att = attachmentsFor(inv, photos);
  const msg = txt(body.message, 5000);
  const subject = `Accident claim ${row.mvaNo}${claimNo ? ' — your claim no. ' + claimNo : ''}${h.policy ? ' — policy ' + h.policy : ''}`;
  const html = (msg ? `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;white-space:pre-wrap;margin-bottom:16px">${e(msg)}</div>` : '') +
    invoiceHtml(h, inv, { insurer, claimNo }) +
    (att.list.length ? `<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px;color:#555">Attached: ${att.list.map(a => e(a.filename)).join(', ')}</p>` : '') +
    (mine ? `<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px">${e(who)} · Claims · MRDC Operations Corporation · <a href="mailto:${e(mine)}">${e(mine)}</a></p>` : '');
  let sw = { id: null, mode: 'Off' };
  try { sw = await C.switchFor(WORKFLOW_SWITCH); } catch (_) { sw = { id: null, mode: 'Off' }; }
  if (sw.mode !== 'Everyone' && sw.mode !== 'Owner test')
    return res.status(409).json({ error: 'Emails from the MVA file are switched off (Patrol Notifications → "MVA file workflow"). Print the claim and email it yourself.' });
  const cc = [...new Set([...cc0, mine].filter(Boolean))].filter(x => !to.includes(x));
  let r;
  if (sw.mode === 'Everyone') r = await L.sendMailDetailed({ to, cc, subject, html, from: CLAIMS_FROM, replyTo: mine || undefined, attachments: att.list });
  else {
    let owners = []; try { owners = C.owners(await C.directory()); } catch (_) { owners = []; }
    const banner = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#FAF0DA;border-left:4px solid #B7791F;padding:12px 16px;margin-bottom:12px">
      <b>Test.</b> The MVA file workflow is set to <b>Owner test</b>, so only you got this. It would have gone to ${e(to.join(', '))}${cc.length ? ' (cc ' + e(cc.join(', ')) + ')' : ''}.</div>`;
    r = owners.length ? await L.sendMailDetailed({ to: owners, subject: '[TEST] ' + subject, html: banner + html, from: CLAIMS_FROM, attachments: att.list })
                      : { sent: [], reason: 'no Owner email on file' };
  }
  await C.stampSwitch(sw, `${row.mvaNo}: claim emailed — ${sw.mode} — for ${to.join(', ')}`).catch(() => {});
  if (!r.sent.length) return res.status(502).json({ error: 'The email did not go out: ' + (r.reason || 'unknown reason') + '. Print the claim and email it yourself.' });
  const line = stampLine(who, `${sw.mode === 'Everyone' ? 'emailed' : 'Owner test, sent to ' + r.sent.join(', ') + ' instead of'} ${to.join(', ')}${cc.length ? ' cc ' + cc.join(', ') : ''}` +
    ` · ${att.list.length} attachment${att.list.length === 1 ? '' : 's'}${att.left.length ? ' (left out, too big: ' + att.left.join(', ') + ')' : ''}`);
  await patch({ [I.emailLog]: (inv.emailLog ? inv.emailLog + '\n' : '') + line });
  let filed = false;
  if (body.markFiled && sw.mode === 'Everyone' && ['With claims', 'Awaiting approval'].includes(row.stage)) {
    const F = M.F, hist = (row.history ? row.history + '\n' : '') + stampLine(who, `filed with ${insurer}${claimNo ? ' (claim ' + claimNo + ')' : ''} — emailed to ${to.join(', ')}`);
    await airtable(`${BASE}/${encodeURIComponent(M.TABLE)}/${encodeURIComponent(row.id)}`, { method: 'PATCH', body: JSON.stringify({ returnFieldsByFieldId: true,
      fields: { [F.stage]: 'Filed with insurance', [F.filedDate]: today(), [F.filedInsurer]: insurer, [F.claimNo]: claimNo, [F.filedBy]: who, [F.filedAt]: now, [F.history]: hist } }) });
    filed = true;
  }
  return answer({ sent: { mode: sw.mode, to, cc, sentTo: r.sent, attachments: att.list.length, left: att.left, filed } });
}

module.exports._test = { invoiceHtml, attachmentsFor, totalsOf, cleanLines, cleanThird, missingFor, prefillFrom, sceneHours, headerOf, ITEM };
