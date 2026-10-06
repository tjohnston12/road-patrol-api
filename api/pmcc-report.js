// api/pmcc-report.js — road-patrol-api (Vercel cron)
//
// The road-conditions report to the PMCC at 06:00, 10:00 and 14:00 (OMM 601.2.2(g)),
// built from the Road Conditions observations since the previous slot. One row in
// PMCC Reports per slot, whatever happens — a slot with no row is the gap
// 601.3.1(d) names, so even "switch Off" and "nothing to send" are recorded.
//
// vercel.json runs it at the top of 09, 10, 13, 14, 17 and 18 UTC: 06/10/14 Atlantic
// in both ADT (UTC-3) and AST (UTC-4). The handler works out which slot (if any)
// the Moncton clock is on and does nothing otherwise. Winter only (15 Oct – 15 Apr).
//
// Guard: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without
// CRON_SECRET configured this refuses to run (fails closed).
//   ?slot=06:00&date=YYYY-MM-DD   run a given slot (re-running one already done does nothing)
//   ?dry=1                        build it and return it; send nothing, write nothing
// Recipients: the "PMCC Road Conditions" distribution list, through the "PMCC
// report" switch (Off / Owner test / Everyone) in Patrol Notifications.

const L = require('./_lib');
const C = require('./_conditions');

function authorized(req) {
  const secret = String(process.env.CRON_SECRET || '').trim();
  if (!secret) return false;
  return String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '') === `Bearer ${secret}`;
}

async function run({ now = new Date(), slot, date, dry } = {}) {
  const p = C.parts(now);
  slot = slot || C.slotAt(now);
  date = date || p.date;
  if (!slot) return { skipped: `not a report time (${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} Atlantic)` };
  if (!C.inWinter(date) && !dry) return { skipped: `${date} is outside winter (15 Oct – 15 Apr)` };
  const key = `${date} ${slot}`;
  const qs = new URLSearchParams(); qs.set('returnFieldsByFieldId', 'true');
  qs.set('filterByFormula', `{Report}='${key}'`);
  const done = ((await L.airtable(`${C.BASE}/${C.T_PMCC}?${qs}`)).records || []).find(r => r.fields[C.P.report] === key);
  if (done && !dry) return { skipped: `${key} already done (${L.sel(done.fields[C.P.status])})` };

  const { end } = C.windowFor(date, slot);
  const obs = await C.observationsSince(new Date(end.getTime() - 30 * 3600000));
  const r = C.buildReport(date, slot, obs);
  if (dry) return { dry: true, key, text: r.text, observed: r.observed, notObserved: r.notObserved };

  const sw = await C.switchFor('PMCC report');
  const dir = await C.directory();
  const real = C.pmccRecipients(dir);
  const { to, preview } = C.deliveryFor(sw.mode, real, dir);
  let sent = [], reason = '';
  if (to.length) {
    const html = (preview ? `<p style="font-family:Arial,sans-serif;background:#FDF0DD;padding:8px 10px;border-radius:6px"><b>Owner test.</b> With the switch on Everyone this would go to: ${L.esc(real.join(', ') || 'nobody — add the PMCC address to the "PMCC Road Conditions" distribution list')}.</p>` : '') + r.html;
    ({ sent, reason } = await L.sendMailDetailed({ to, subject: `${preview ? '[TEST] ' : ''}MRDC road conditions — ${date} ${slot}`, html }));
  } else reason = sw.mode === 'Off' ? 'the PMCC report switch is Off' : (sw.mode === 'Everyone' ? 'no PMCC address on the "PMCC Road Conditions" list' : 'no Owner address');
  const status = sent.length ? (preview ? 'Owner test' : 'Sent') : (sw.mode === 'Off' ? 'Off' : 'Not sent');
  await L.airtable(`${C.BASE}/${C.T_PMCC}`, { method: 'POST', body: JSON.stringify({ typecast: false, fields: {
    [C.P.report]: key, [C.P.date]: date, [C.P.slot]: slot, [C.P.generatedAt]: new Date().toISOString(), [C.P.status]: status,
    [C.P.sentTo]: sent.length ? sent.join(', ') : '', [C.P.observed]: r.observed, [C.P.notObserved]: r.notObserved,
    [C.P.summary]: r.text, [C.P.note]: sent.length ? (preview ? `Would go to: ${real.join(', ') || 'nobody yet'}` : '') : `not sent — ${reason}` } }) });
  await C.stampSwitch(sw, `${key}: ${status}${sent.length ? ' → ' + sent.join(', ') : ' — ' + reason}`);
  return { key, status, sent: sent.length, observed: r.observed, notObserved: r.notObserved, reason };
}

module.exports = async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  const Q = req.query || {};
  try {
    const slot = C.SLOTS.includes(String(Q.slot || '')) ? String(Q.slot) : '';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(Q.date || '')) ? String(Q.date) : '';
    return res.status(200).json({ ok: true, result: await run({ slot, date: date || undefined, dry: Q.dry === '1' }) });
  } catch (e) {
    console.error('[pmcc-report]', e.message);
    return res.status(500).json({ error: 'PMCC report failed', detail: e.message });
  }
};
module.exports._run = run;
