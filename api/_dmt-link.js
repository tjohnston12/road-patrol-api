/* api/_dmt-link.js — the DMT number on an MVA file, kept in step and linked to the DMT
   (Troy, 2026-10-27: "if they type the dmt number into the accident report can you link
   them back that way and attach them?").

   One number, two places in the MVA base — the accident report's "DMT number"
   (Accident Reports fldYCrKMg0Jc3HIR5) and the MVA folder's "DMT work order no."
   (MVA fldh1qB5gUhhPlrxS). Whichever is changed, the other is set to match, and the
   DMT work order is told which MVA it belongs to (DMT /api/intake action link-mva,
   service key): it gets Linked MVA + an Activity Log line, and shows a banner that
   opens the MVA file. Changing the number lets go of the old work order.

   Underscore file: a helper, not a Vercel function (road-patrol-api is at the Hobby
   limit of 12). Never fatal — the patroller's save stands even if the DMT is down. */
'use strict';
const DMT_INTAKE_URL = process.env.DMT_INTAKE_URL || 'https://dmt.mrdc-htra.com/api/intake';
const DMT_INTAKE_SECRET = () => (process.env.DMT_INTAKE_SECRET || '').trim();

/* Same rule as the DMT's normWo: "WO-2026-0047", "wo 2026 0047", "2026-0047", or a
   legacy number (113852156). No zero-padding — autosave sends half-typed numbers.
   Anything else ("Na", "n/a", "pending") is not a work order number → ''. */
function normWo(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  const m = s.match(/^(?:WO)?[\s-]*(\d{4})[\s-]+(\d{1,6})$/) || s.match(/^WO[\s-]*(\d{4})[\s-]*(\d{1,6})$/);
  if (m) return `WO-${m[1]}-${m[2]}`;
  if (/^\d{6,12}$/.test(s)) return s;
  return '';
}
const dmtUrl = wo => 'https://dmt.mrdc-htra.com/?wo=' + encodeURIComponent(wo);

/* Ask the DMT. Returns the DMT's answer ({found, workOrder, status, …, linked}) or
   {found:false, reason} — never throws. */
async function callDmt(payload, ms) {
  const key = DMT_INTAKE_SECRET();
  if (!key) return { found: false, checked: false, reason: 'DMT link not configured' };
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), ms || 6000) : null;
  try {
    const r = await fetch(DMT_INTAKE_URL, { method: 'POST', signal: ctl ? ctl.signal : undefined,
      headers: { 'Content-Type': 'application/json', 'x-intake-key': key },
      body: JSON.stringify(Object.assign({ action: 'link-mva' }, payload)) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) return { found: false, checked: false, reason: j.error || ('DMT ' + r.status) };
    delete j.ok;
    return Object.assign({ checked: true }, j);
  } catch (e) {
    return { found: false, checked: false, reason: e.name === 'AbortError' ? 'DMT did not answer' : e.message };
  } finally { if (t) clearTimeout(t); }
}

/* The number changed on one side: link the new work order (and let go of the old). */
function link({ wo, prevWo, mvaNo, mvaId, by }) {
  return callDmt({ wo: wo || '', unlinkWo: prevWo || '', mva: mvaNo || '', mvaId: mvaId || '', by: by || '' });
}
/* Just look — for showing the work order's status on the folder. Short timeout. */
function peek(wo) {
  if (!normWo(wo)) return Promise.resolve({ found: false, reason: String(wo || '').trim() ? 'not a work order number' : 'blank' });
  return callDmt({ wo, peek: true }, 3500);
}

/* Opening the file: look, and if the work order does not yet name this MVA (a number
   saved before the link existed, or the DMT was down when it was saved), link it now.
   Only when it names NO MVA: one work order can cover two crashes on the same rail, and
   opening each file must not flip it back and forth. Typing the number is what moves it. */
async function ensure(wo, mvaNo, mvaId, by) {
  const d = await peek(wo);
  if (!d.found || !mvaNo || d.linkedMva) return d;
  const l = await link({ wo, mvaNo, mvaId, by });
  return l.found ? l : d;
}

module.exports = { normWo, dmtUrl, link, peek, ensure, DMT_INTAKE_URL };
