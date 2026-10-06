// api/conditions.js — road-patrol-api (Vercel)
//
// Winter Road Conditions for the Road Patrol app (www.mrdc-htra.com/patrol/conditions.html).
// Base: MRDC-HTRA - Road Patrol (app2m7rkP51kLLpbe), table Road Conditions. Rules,
// recipients and the PMCC report shape live in ./_conditions.js.
//
// GET   /api/conditions?meta=1           -> { depots, routes, division, conditions, patrollers, me, admin, winter }
// GET   /api/conditions                  -> { board, observations, pmcc }   the last 24 hours
// GET   /api/conditions?preview=1        -> { report }  what the next PMCC report would say (admin)
// POST  /api/conditions {depot,route,conditions,comments?,observedAt?,patroller?,alert?}
//                                        -> { observation, alert? }
// POST  /api/conditions?id=rec…&action=alert {note?} -> { observation, alert }
//
// The ALERT is a button (Troy, 2026-10-06: "let alert be a button that the
// patroller hits to alert other patrollers and managers"). It goes to the
// "Winter Road Conditions" subscribers — or, until anyone subscribes, managers,
// Supervisor / Operators and patrollers by job title — through the "Adverse
// conditions alert" switch in Patrol Notifications (Off / Owner test / Everyone).
// One alert per observation; a second press says when it already went.

const L = require('./_lib');
const C = require('./_conditions');
const { requireCaller } = require('./_auth');

const BOARD_HOURS = 24;

async function sendAlert(obs, caller, note) {
  const sw = await C.switchFor('Adverse conditions alert');
  const dir = await C.directory();
  const real = C.alertRecipients(dir);
  const { to, preview } = C.deliveryFor(sw.mode, real, dir);
  const t = C.hhmm(obs.observedAt);
  const subject = `${preview ? '[TEST] ' : ''}Adverse road conditions — ${obs.route} (${obs.depot}) — ${obs.conditions.join(', ')}`;
  const esc = L.esc;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#15243B">
    ${preview ? `<p style="background:#FDF0DD;padding:8px 10px;border-radius:6px"><b>Owner test.</b> With the switch on Everyone this would go to ${real.length} people: ${esc(real.join(', ') || 'nobody — no address found')}.</p>` : ''}
    <h2 style="margin:0 0 6px;color:#A32D2D">Adverse road conditions</h2>
    <p style="margin:0 0 4px"><b>${esc(obs.route)}</b> · ${esc(obs.depot)} depot · ${esc(obs.division)} Division</p>
    <p style="margin:0 0 4px;font-size:17px"><b>${esc(obs.conditions.join(', '))}</b></p>
    <p style="margin:0 0 4px">Observed ${esc(t)} by ${esc(obs.patroller)}${obs.submittedBy && obs.submittedBy !== obs.patroller ? ` (sent by ${esc(obs.submittedBy)})` : ''}</p>
    ${obs.comments ? `<p style="margin:8px 0 4px">${esc(obs.comments)}</p>` : ''}
    ${note ? `<p style="margin:8px 0 4px"><b>Note:</b> ${esc(note)}</p>` : ''}
    <p style="margin-top:14px"><a href="https://www.mrdc-htra.com/patrol/conditions.html">Open the road conditions board</a></p>
    <p style="font-size:12px;color:#777">Sent from the MRDC Road Patrol app by ${esc(caller.name)} · OMM 601.2.2(h).</p></div>`;
  let sent = [], reason = '';
  if (to.length) ({ sent, reason } = await L.sendMailDetailed({ to, subject, html }));
  else reason = sw.mode === 'Off' ? 'the alert switch is Off' : 'no recipient address found';
  const record = sent.length ? (preview ? `Owner test: ${sent.join(', ')} (would go to ${real.length})` : sent.join(', ')) : `not sent — ${reason}`;
  const upd = await L.airtable(`${C.BASE}/${C.T_OBS}/${obs.id}`, { method: 'PATCH', body: JSON.stringify({
    returnFieldsByFieldId: true,
    fields: { [C.F.alertSent]: true, [C.F.alertAt]: new Date().toISOString(), [C.F.alertTo]: record } }) });
  await C.stampSwitch(sw, `${new Date().toISOString().slice(0, 16)} ${obs.route}: ${record}`);
  return { observation: C.shapeObs(upd), alert: { mode: sw.mode, sent: sent.length, wouldReach: real.length, note: record } };
}

module.exports = async function handler(req, res) {
  if (L.cors(req, res)) return;
  const caller = await requireCaller(req, res);       // before the try (§2b)
  if (!caller) return;
  const Q = req.query || {};
  try {
    if (req.method === 'GET') {
      if (Q.meta) {
        const patrollers = await L.getPatrollers().catch(() => []);
        const today = C.parts(new Date()).date;
        return res.status(200).json({
          depots: C.DEPOTS, routes: C.ROUTES, division: C.DIVISION, conditions: C.CONDITIONS, slots: C.SLOTS,
          patrollers: patrollers.map(p => p.name), me: caller.name, admin: caller.isAdmin, winter: C.inWinter(today), today,
        });
      }
      if (Q.preview) {
        if (!caller.isAdmin) return res.status(403).json({ error: 'Only a supervisor can preview the PMCC report.' });
        const now = new Date(), p = C.parts(now);
        const slot = C.SLOTS.find(s => s >= `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`) || C.SLOTS[0];
        const date = slot === C.SLOTS[0] && p.hour >= 14 ? C.parts(new Date(now.getTime() + 12 * 3600000)).date : p.date;
        const obs = await C.observationsSince(new Date(now.getTime() - 36 * 3600000));
        const r = C.buildReport(date, slot, obs);
        return res.status(200).json({ report: { date, slot, text: r.text, observed: r.observed, notObserved: r.notObserved } });
      }
      const since = new Date(Date.now() - BOARD_HOURS * 3600000);
      const observations = (await C.observationsSince(since)).slice(0, 300);
      const today = C.parts(new Date()).date;
      let pmcc = [];
      try {
        const qs = new URLSearchParams(); qs.set('returnFieldsByFieldId', 'true');
        qs.set('filterByFormula', `DATETIME_FORMAT({Report Date},'YYYY-MM-DD')='${today}'`);
        const page = await L.airtable(`${C.BASE}/${C.T_PMCC}?${qs}`);
        pmcc = (page.records || []).map(r => ({ slot: L.sel(r.fields[C.P.slot]), status: L.sel(r.fields[C.P.status]),
          sentTo: r.fields[C.P.sentTo] || '', generatedAt: r.fields[C.P.generatedAt] || '' }))
          .filter(x => C.SLOTS.includes(x.slot));
      } catch (_) { pmcc = []; }
      return res.status(200).json({ board: C.latestByRoute(observations), observations, pmcc, today, hours: BOARD_HOURS });
    }

    if (req.method === 'POST') {
      const body = L.parseBody(req);
      if (Q.id) {
        if (!/^rec[A-Za-z0-9]{14}$/.test(String(Q.id))) return res.status(400).json({ error: 'Bad id' });
        if (Q.action !== 'alert') return res.status(400).json({ error: 'Unknown action' });
        const qs = new URLSearchParams(); qs.set('returnFieldsByFieldId', 'true');
        const obs = C.shapeObs(await L.airtable(`${C.BASE}/${C.T_OBS}/${Q.id}?${qs}`));
        const mine = [obs.submittedBy, obs.patroller].some(n => n && n.trim().toLowerCase() === String(caller.name || '').trim().toLowerCase());
        if (!mine && !caller.isAdmin) return res.status(403).json({ error: 'Only the patroller who made this observation, or a supervisor, can send its alert.' });
        if (obs.alertSent) return res.status(409).json({ error: `The alert for this observation already went at ${C.hhmm(obs.alertSentAt)}.`, observation: obs });
        return res.status(200).json(await sendAlert(obs, caller, String(body.note || '').trim().slice(0, 500)));
      }
      const c = C.cleanObservation(body, caller);
      if (c.error) return res.status(400).json({ error: c.error });
      const created = await L.airtable(`${C.BASE}/${C.T_OBS}`, { method: 'POST',
        body: JSON.stringify({ returnFieldsByFieldId: true, fields: c.fields }) });
      const observation = C.shapeObs(created);
      if (body.alert === true) {
        // The observation is saved first: an alert that fails must not lose it.
        try { return res.status(201).json(await sendAlert(observation, caller, String(body.note || '').trim().slice(0, 500))); }
        catch (e) { return res.status(201).json({ observation, alertError: 'Saved, but the alert did not go: ' + e.message }); }
      }
      return res.status(201).json({ observation });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[conditions]', e.message);
    return res.status(e.status === 404 ? 404 : 500).json({ error: e.status === 404 ? 'Not found' : (e.message || 'Server error') });
  }
};
module.exports._sendAlert = sendAlert;
