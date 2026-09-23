/*
 * api/_auth.js — server-side identity + role check for road-patrol-api.
 * ---------------------------------------------------------------------------
 * Ported from mrdc-employees-api/api/_auth.js, which was ported from
 * facility-safety-api. Same shape, same reasoning; only APP and the role rule
 * differ.
 *
 * Until 2026-09-23 this API had NO authentication at all. _lib.js said so:
 * "the x-user-* / x-app-role headers come from the SSO session via htra-auth.js.
 * They close the in-app path but are spoofable in a direct API call". Every
 * authorization decision came from `x-user-role` / `x-app-role` — headers the
 * caller sets — and nothing ever looked at the session cookie, so an anonymous
 * request got a 200 and every patrol report back.
 *
 * How it works now: the API is served from patrol-api.mrdc-htra.com, so the
 * browser sends the shared-SSO cookie (htra_session, Domain=.mrdc-htra.com)
 * with every request — the patrol pages already fetch with credentials:'include'
 * and _lib.cors() already returns Access-Control-Allow-Credentials. We forward
 * that cookie to the auth service's /api/session, which validates it and
 * re-reads the person's live role and app access. One source of truth for
 * sessions; a header cannot forge any of it.
 *
 * ⚠️ APP MUST STAY 'Patrol'. It is the key into auth's APP_ROLE_FIELD map
 * ('Patrol' -> 'Patrol Role', added there 2026-09-21) AND it is what the pages
 * ask for — patrol/index.html, daily-report.html and mva.html all load
 * htra-auth.js with data-app="Patrol". If the two ever disagree, the role the
 * UI shows and the role the API enforces drift apart. A name auth does not
 * recognise comes back with an empty role, which locks everyone out.
 *
 * ⚠️ isAdmin REPRODUCES THE OLD RULE EXACTLY, from the verified session instead
 * of from headers:
 *     appRole in (Admin, Manager)  OR  org role in (Owner, Admin)
 * Nothing widens and nothing narrows. Note 'Patroller/Supervisor' is NOT admin
 * and never was — despite what the 403 text says about supervisors. Changing
 * who counts as an admin is a separate decision from closing the hole, and it
 * is Troy's to make.
 *
 * Usage in a handler:
 *   const { requireCaller } = require('./_auth');
 *   module.exports = async (req, res) => {
 *     if (L.cors(req, res)) return;               // handled the preflight
 *     const caller = await requireCaller(req, res);
 *     if (!caller) return;                        // 401 already sent
 *     // caller.name / caller.isAdmin available here
 *   };
 */

const AUTH_URL = process.env.AUTH_URL || 'https://auth.mrdc-htra.com';
const APP = 'Patrol';

// Per-app roles that carry admin rights in Road Patrol. Kept as a named list
// because the old _lib.ADMIN_ROLES was one, and the values are the same.
const ADMIN_APP_ROLES = ['Admin', 'Manager'];
const ADMIN_ORG_ROLES = ['Owner', 'Admin'];

/* Resolve the signed-in caller from the forwarded session cookie, or null.
   Never throws: a failure to reach auth is an unauthenticated caller, not a
   500, so a flaky auth service cannot be made to look like an open door. */
async function getCaller(req) {
  const cookie = req.headers.cookie || '';
  if (!/(?:^|;\s*)htra_session=/.test(cookie)) return null;
  let d;
  try {
    const r = await fetch(`${AUTH_URL}/api/session?app=${APP}`, { headers: { cookie } });
    if (!r.ok) return null;
    d = await r.json();
  } catch (_) {
    return null;
  }
  if (!d || !d.ok || !d.user) return null;

  const orgRole = d.user.role || '';
  const appRole = d.appRole || '';

  return {
    user: d.user,
    apps: Array.isArray(d.apps) ? d.apps : [],
    orgRole,
    appRole,
    // The caller's name, from the validated session — never from x-user-name.
    // Everything that stamps a record or scopes a list reads this.
    name: d.user.name || '',
    employeeId: d.user.employeeId || '',
    isAdmin: ADMIN_APP_ROLES.includes(appRole) || ADMIN_ORG_ROLES.includes(orgRole),
    allowed: d.allowed !== false,
  };
}

/* Guard a handler: any signed-in caller who has Patrol in their App Access.
   Returns the caller, or writes the 401 and returns null.

   ⚠️ Call this BEFORE the handler's try/catch. Inside it, the 401 would be
   swallowed and re-reported as a 500 — the same mistake the September auth
   audit found elsewhere.

   ⚠️ On App Access: only 2 of the 11 active employees with a patrol job title
   have 'Patrol' in App Access today. That is not a problem yet, because
   patrol/index.html still gates the whole app to the Owner while it is in
   testing. It becomes one the day the app opens to patrollers: they each need
   'Patrol' granted, or this returns 401 and they cannot file a report.
   Granting it is a permissions change and Troy's click, not something this
   file should paper over by admitting anyone with a session. */
async function requireCaller(req, res) {
  const caller = await getCaller(req);
  if (!caller || !caller.allowed) {
    res.status(401).json({ error: 'Not signed in' });
    return null;
  }
  return caller;
}

/* Guard a handler and require admin rights. */
async function requireAdmin(req, res, message) {
  const caller = await requireCaller(req, res);
  if (!caller) return null;
  if (!caller.isAdmin) {
    res.status(403).json({ error: message || 'You do not have permission to do that.' });
    return null;
  }
  return caller;
}

module.exports = { getCaller, requireCaller, requireAdmin, APP, ADMIN_APP_ROLES, ADMIN_ORG_ROLES };
