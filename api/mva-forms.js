/*
 * api/mva-forms.js — the two other DeviceMagic MVA forms, made electronic (2026-10-06).
 * ---------------------------------------------------------------------------
 * Troy: "lets make the accident forms related to mva electronic as they are in device
 * magic please". The Accident Report and Proof of Repairs are api/accident.js; these are
 * the other two, field for field from their exports:
 *
 *  · MVA Scene Clear — "only required when traffic has been affected or an update to
 *    others is needed": the MVA, the patroller, the time the scene cleared, comments, and
 *    a copy to the patroller. One MVA can have several (each is an update). Each one
 *    emails the MVA's distribution (AccidentGroup2) — the same as the notification.
 *  · MVA Investigation Report — "to document the investigation of an MVA when a Hit &
 *    Run occurs or when damages are unknown": division, date verified / verified by,
 *    MRDC/SNIC operations ongoing (+ units), hit & run, RCMP contacted (+ officer, file
 *    no., details from police), unknown damages at notification, facility assets damaged,
 *    damages entered in the DMT, description, photos of the damages, GPS. One per MVA
 *    (Investigation No. = <MVA No.>-INV), saved as a draft, then submitted and emailed.
 *
 * Email goes through the same Patrol Notifications switch as the MVA notification
 * ("MVA notification": Off / Owner test / Everyone). Addresses come from the directory.
 *
 *   GET  ?mva=rec…&form=scene|investigation
 *   POST {mva, form:'scene', time, comments, copyMe}
 *   POST {mva, form:'investigation', report:{…}, submit?}
 *   POST {mva, form:'investigation', action:'photo'|'photoRemove', …}
 * Who: the MVA's patroller / submitter or an admin may file these; the file's reviewers
 * can read them (mva.js loadOwned). A submitted investigation is read-only except to an admin.
 */
const L = require('./_lib');
const { requireCaller } = require('./_auth');
const C = require('./_conditions');
const M = require('./mva').lib;
const { arr, sel, esc, airtable } = L;

const NOTIFY_TO = process.env.MVA_NOTIFY_TO || 'AccidentGroup2@mrdc.ca';
const SWITCH = 'MVA notification';
const APP_URL = process.env.PATROL_APP_URL || 'https://www.mrdc-htra.com/patrol/';
const T_SC = 'tblExJGXFCqLKPU2V', T_INV = 'tblA5YveLsiSYd98t';
const SC = { mvaNo: 'fldgoMWeGAjnE1rDn', mva: 'flda7zdk29u9LrHkn', patroller: 'fldeAr94oFTARvz1F', time: 'fld9qAqOV0cq9erbe',
  comments: 'fldtM6ZfOeYIkKLCM', sendCopy: 'fldhoeecflNZN1UGq', copyEmail: 'fldZqEZt2MpFKCD66', submittedBy: 'fld8IPKtkVfxovtTI',
  submittedAt: 'fldRBkUcn9SLcNBmE', notified: 'fldoFxoKrlfEERGos' };
const IV = { invNo: 'fldCNGwdH57csZuUV', openedAt: 'fldSxull8ZS33Tsj9', investigator: 'fldu8z1OpJYo2Mjtp', officer: 'fldm2cuINWQWvVVdD',
  policeFile: 'fldIRpG4Nbf4ODFzF', policeDetails: 'fld1NeyHiCeYftBvd', comments: 'fldwDKuYxol78asjo', photos: 'fldDVGx1LaJuf2HmO',
  submittedBy: 'fldXWkSC29Fho0v9F', submittedAt: 'fldnPnOjQnq0A44ah', mva: 'fldBJWC0xPHcECoRq', verifiedBy: 'fldyQZXCo9NWhtUCF',
  dateVerified: 'flduXhZdFfYgFeCVx', opsOngoing: 'fldQOQS2TxnikWGRf', units: 'fldF4J8LhLq9Eh8GV', rcmp: 'fldIlTCNW72tOSE3y',
  unknownDamages: 'fldLWxyPz9Stz4J8I', facilityDamaged: 'fldSkexOw2KTCNEOo', dmtEntered: 'fldvzHRLbbADg9eDA', gps: 'fldjTlFHyb6CYfY7W',
  division: 'fld5UhV73aQlRQk3W', hitRun: 'fld2fY2OjV62vSAx8', status: 'fldnSafV7m2ll4Xf3', notified: 'fldgGLpGPnTPFAcIE' };
const CHOICES = { divisions: ['Eastern', 'Western'], facility: ['Yes', 'No'] };
const IV_TEXT = ['officer', 'policeFile', 'policeDetails', 'comments', 'verifiedBy', 'units', 'gps'];
const IV_BOOL = ['opsOngoing', 'rcmp', 'unknownDamages', 'dmtEntered', 'hitRun'];

const norm = n => String(n || '').trim().toLowerCase();
async function emailOf(name, ctx) { try { const t = await M.team(ctx); return t.emailOf(name) || ''; } catch (_) { return ''; } }
// The MVA's distribution, through the notification switch. Returns the line for "Notified".
async function send(to, subject, html) {
  const real = [...new Set(to.filter(Boolean).map(e => e.trim()))];
  let sw = { id: null, mode: 'Off' };
  try { sw = await C.switchFor(SWITCH); } catch (_) { sw = { id: null, mode: 'Off' }; }
  let sent = [], note;
  if (sw.mode === 'Everyone') { sent = await L.sendMail({ to: real, subject, html }); note = sent.join(', ') || 'not sent'; }
  else if (sw.mode === 'Owner test') {
    let owners = []; try { owners = C.owners(await C.directory()); } catch (_) { owners = []; }
    if (owners.length) sent = await L.sendMail({ to: owners, subject: '[TEST] ' + subject,
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#FAF0DA;border-left:4px solid #B7791F;padding:12px 16px;margin-bottom:12px;max-width:640px"><b>Test.</b> The MVA notification is set to <b>Owner test</b> in the Road Patrol base (Patrol Notifications), so only you got this. It would have gone to: ${esc(real.join(', ') || 'nobody')}.</div>` + html });
    note = `Owner test — sent to ${sent.join(', ') || 'nobody'}; would have gone to ${real.join(', ')}`;
  } else note = `Off — not sent; would have gone to ${real.join(', ')}`;
  await C.stampSwitch(sw, subject + ': ' + note).catch(() => {});
  return { mode: sw.mode, sent, note };
}
function mailHtml(mva, title, rows, extra) {
  const where = [mva.route, mva.km != null ? 'km ' + Number(mva.km).toFixed(3) : '', mva.direction].filter(Boolean).join(' · ');
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:640px">
  <div style="background:#1E2B5E;color:#fff;padding:16px 20px;border-bottom:3px solid #C9A84C">
    <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.65)">MRDC Road Patrol · ${esc(title)}</div>
    <div style="font-size:20px;font-weight:600;margin-top:2px">${esc(mva.mvaNo)}</div></div>
  <p style="margin:12px 0;color:#6B6B6B">${esc(where)}</p>
  <table style="width:100%;border-collapse:collapse">${rows.filter(r => r[1] !== undefined).map(([k, v]) => `<tr><td style="padding:6px 0;color:#6B6B6B;width:200px;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;font-weight:500;white-space:pre-wrap">${esc(v === '' || v == null ? '—' : v)}</td></tr>`).join('')}</table>
  ${extra || ''}
  <p style="margin-top:16px"><a href="${esc(APP_URL)}mvas.html?id=${encodeURIComponent(mva.id)}" style="color:#15616D;font-weight:600">Open the MVA</a></p></div>`;
}
const mt = iso => { if (!iso) return ''; try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Moncton', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)).replace(',', ''); } catch (_) { return iso; } };

// ── Scene Clear ───────────────────────────────────────────────────────────────
function shapeSC(r) { const f = r.fields || {};
  return { id: r.id, time: f[SC.time] || '', comments: f[SC.comments] || '', patroller: f[SC.patroller] || '', sendCopy: !!f[SC.sendCopy],
    submittedBy: f[SC.submittedBy] || '', submittedAt: f[SC.submittedAt] || '', notified: f[SC.notified] || '' }; }
async function sceneClears(mva) {
  const qs = new URLSearchParams(); qs.set('returnFieldsByFieldId', 'true');
  qs.set('filterByFormula', `{MVA No.}='${String(mva.mvaNo).replace(/'/g, "\\'")}'`);
  const j = await airtable(`${M.BASE}/${T_SC}?${qs}`);
  return (j.records || []).map(shapeSC).sort((a, b) => String(b.time).localeCompare(String(a.time)));
}

// ── Investigation ─────────────────────────────────────────────────────────────
function shapeIV(r) { if (!r) return null; const f = r.fields || {}, o = { id: r.id, invNo: f[IV.invNo] || '' };
  for (const k of IV_TEXT) o[k] = f[IV[k]] || '';
  for (const k of IV_BOOL) o[k] = !!f[IV[k]];
  Object.assign(o, { division: sel(f[IV.division]), facilityDamaged: sel(f[IV.facilityDamaged]), dateVerified: f[IV.dateVerified] || '',
    status: sel(f[IV.status]) || 'Draft', submittedBy: f[IV.submittedBy] || '', submittedAt: f[IV.submittedAt] || '', notified: f[IV.notified] || '',
    photos: arr(f[IV.photos]).map(a => ({ id: a.id, url: a.url, filename: a.filename, thumb: a.thumbnails?.large?.url || a.thumbnails?.small?.url || '' })) });
  return o; }
const invNo = mva => `${mva.mvaNo}-INV`;
async function findIV(mva) {
  const qs = new URLSearchParams(); qs.set('returnFieldsByFieldId', 'true'); qs.set('maxRecords', '1');
  qs.set('filterByFormula', `{Investigation No.}='${invNo(mva).replace(/'/g, "\\'")}'`);
  return ((await airtable(`${M.BASE}/${T_INV}?${qs}`)).records || [])[0] || null;
}
function ivFields(r) {
  const f = {};
  for (const k of IV_TEXT) if (r[k] !== undefined) f[IV[k]] = String(r[k] == null ? '' : r[k]).slice(0, 5000);
  for (const k of IV_BOOL) if (r[k] !== undefined) f[IV[k]] = !!r[k];
  if (r.division !== undefined) f[IV.division] = CHOICES.divisions.includes(r.division) ? r.division : null;
  if (r.facilityDamaged !== undefined) f[IV.facilityDamaged] = CHOICES.facility.includes(r.facilityDamaged) ? r.facilityDamaged : null;
  if (r.dateVerified !== undefined) f[IV.dateVerified] = /^\d{4}-\d{2}-\d{2}$/.test(String(r.dateVerified)) ? r.dateVerified : null;
  return f;
}
// What submit needs (the DeviceMagic form, plus a photo whenever assets were damaged —
// photos are what get a claim paid).
function ivMissing(v) {
  const out = [];
  if (!v.division) out.push('Division');
  if (!v.dateVerified) out.push('Date verified');
  if (!v.verifiedBy) out.push('Verified by');
  if (v.hitRun && !v.rcmp) out.push('Contact the RCMP (required for a hit & run)');
  if (!v.facilityDamaged) out.push('Were facility assets damaged?');
  if (!String(v.comments || '').trim()) out.push('Describe the damages / comments');
  if (v.facilityDamaged === 'Yes' && !(v.photos || []).length) out.push('Photos of the damages');
  return out;
}

module.exports = async function handler(req, res) {
  if (L.cors(req, res)) return;
  if (!L.PAT) return res.status(500).json({ error: 'Server not configured (AIRTABLE_PAT missing)' });
  const caller = await requireCaller(req, res);
  if (!caller) return;
  try {
    const ctx = {};
    const q = req.method === 'GET' ? (req.query || {}) : L.parseBody(req);
    const form = String(q.form || '');
    if (!['scene', 'investigation'].includes(form)) return res.status(400).json({ error: 'Unknown form' });
    const mva = await M.loadOwned(q.mva, caller, ctx);
    if (!mva) return res.status(404).json(M.NOT_FOUND);
    const mayFile = !!(mva.access && (mva.access.own || mva.access.admin));
    const now = new Date().toISOString(), who = caller.name || '';

    if (form === 'scene') {
      if (req.method === 'GET') return res.status(200).json({ mva, list: await sceneClears(mva), canFile: mayFile });
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      if (!mayFile) return res.status(403).json({ error: 'Only the patroller on this MVA sends its scene clear.' });
      const time = String(q.time || '');
      if (!/^\d{4}-\d{2}-\d{2}T/.test(time) || isNaN(Date.parse(time))) return res.status(400).json({ error: 'The time the scene cleared is required' });
      const copyTo = q.copyMe ? (await emailOf(mva.patroller, ctx)) || (await emailOf(who, ctx)) : '';
      const rec = await airtable(`${M.BASE}/${T_SC}`, { method: 'POST', body: JSON.stringify({ returnFieldsByFieldId: true, fields: {
        [SC.mvaNo]: mva.mvaNo, [SC.mva]: [mva.id], [SC.patroller]: mva.patroller || who, [SC.time]: time,
        [SC.comments]: String(q.comments || '').slice(0, 5000), [SC.sendCopy]: !!q.copyMe, [SC.copyEmail]: copyTo || null,
        [SC.submittedBy]: who, [SC.submittedAt]: now } }) });
      const mail = await send([NOTIFY_TO, copyTo], `MVA ${mva.mvaNo} — scene clear ${mt(time).slice(11)}`,
        mailHtml(mva, 'Scene clear', [['Scene cleared', mt(time)], ['Patroller', mva.patroller || who], ['Comments', String(q.comments || '')]]));
      await airtable(`${M.BASE}/${T_SC}/${rec.id}`, { method: 'PATCH', body: JSON.stringify({ returnFieldsByFieldId: true, fields: { [SC.notified]: mail.note } }) });
      return res.status(200).json({ mva, list: await sceneClears(mva), mail: { mode: mail.mode } });
    }

    // investigation
    let rec = await findIV(mva);
    if (req.method === 'GET') return res.status(200).json({ mva, report: shapeIV(rec), choices: CHOICES,
      canEdit: mayFile && (!rec || shapeIV(rec).status !== 'Submitted' || !!caller.isAdmin) });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!mayFile) return res.status(403).json({ error: 'Only the patroller on this MVA fills in its investigation report.' });
    if (rec && shapeIV(rec).status === 'Submitted' && !caller.isAdmin) return res.status(409).json({ error: 'The investigation report has been submitted.' });
    if (!rec) rec = await airtable(`${M.BASE}/${T_INV}`, { method: 'POST', body: JSON.stringify({ returnFieldsByFieldId: true, fields: {
      [IV.invNo]: invNo(mva), [IV.mva]: [mva.id], [IV.status]: 'Draft', [IV.investigator]: who, [IV.openedAt]: now,
      [IV.hitRun]: !!mva.hitRun, [IV.division]: CHOICES.divisions.includes(mva.division) ? mva.division : null } }) });
    const patch = fields => airtable(`${M.BASE}/${T_INV}/${rec.id}`, { method: 'PATCH', body: JSON.stringify({ returnFieldsByFieldId: true, fields }) });
    if (q.action === 'photo') {
      if (!q.data) return res.status(400).json({ error: 'data (base64) is required' });
      await L.uploadAttachment({ base: M.BASE, recordId: rec.id, fieldId: IV.photos, filename: q.filename, contentType: q.contentType, data: q.data });
      rec = await airtable(`${M.BASE}/${T_INV}/${rec.id}?returnFieldsByFieldId=true`);
    } else if (q.action === 'photoRemove') {
      rec = await patch({ [IV.photos]: arr((rec.fields || {})[IV.photos]).filter(a => a.id !== q.fileId).map(a => ({ id: a.id })) });
    } else {
      const f = q.report ? ivFields(q.report) : {};
      if (Object.keys(f).length) rec = await patch(f);
      if (q.submit) {
        const v = shapeIV(rec), missing = ivMissing(v);
        if (missing.length) return res.status(400).json({ error: 'Still needed: ' + missing.join(', '), missing, report: v });
        const mail = await send([NOTIFY_TO], `MVA ${mva.mvaNo} — investigation report${v.hitRun ? ' (hit & run)' : ''}`,
          mailHtml(mva, 'Investigation report', [['Division', v.division], ['Verified', `${v.dateVerified} — ${v.verifiedBy}`],
            ['MRDC / SNIC operations ongoing', v.opsOngoing ? 'Yes' + (v.units ? ' — ' + v.units : '') : 'No'], ['Hit & run', v.hitRun ? 'Yes' : 'No'],
            ['RCMP contacted', v.rcmp ? 'Yes' : 'No'], ['Officer', v.officer], ['Police file no.', v.policeFile], ['Details from police', v.policeDetails],
            ['Unknown damages at notification', v.unknownDamages ? 'Yes' : 'No'], ['Facility assets damaged', v.facilityDamaged],
            ['Entered in the DMT', v.dmtEntered ? 'Yes' : 'No'], ['Damages / comments', v.comments], ['GPS', v.gps], ['Photos', String(v.photos.length)]]));
        rec = await patch({ [IV.status]: 'Submitted', [IV.submittedBy]: who, [IV.submittedAt]: now, [IV.notified]: mail.note });
        return res.status(200).json({ mva, report: shapeIV(rec), saved: 'submitted', mail: { mode: mail.mode } });
      }
    }
    return res.status(200).json({ mva, report: shapeIV(rec), saved: 'saved' });
  } catch (e) {
    console.error('mva-forms error:', e);
    return res.status(e.status && e.status < 500 ? e.status : 500).json({ error: e.message || 'Server error' });
  }
};
module.exports.lib = { ivMissing, ivFields, shapeIV, IV, SC };
