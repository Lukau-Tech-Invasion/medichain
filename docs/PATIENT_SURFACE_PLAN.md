# Step 1 — a patient session reaches only the patient surface

Status: **approved 2026-11-01; implemented** in `api/src/middleware/patient_surface.rs`,
`api/build.rs` (route table) and `scripts/check-patient-surface.py`. Not committed.

## The problem, as the code stands

* Every login, patient or staff, gets the same kind of token from
  `handlers/auth_jwt.rs` (`jwt::issue_access_token`). Its `context` claim is
  `None`. The `patient`/`professional` context tokens in
  `jwt::issue_context_access_token` exist, but nothing the apps use issues them.
* About 460 route paths are registered in `api/src/routes.rs`. Whether a patient
  may call one is decided **inside each handler**. `middleware/authorized_user.rs`
  records the same finding (HZ-010): authentication is centralised,
  authorization is not, and HZ-009 was a handler that never checked.
* So a patient account's token is refused from a staff endpoint only if that
  endpoint's author remembered to refuse it. One forgotten check exposes
  hospital data to anyone who registers as a patient.

The patient app needs a small fraction of those routes. Everything else should be
refused **before any handler runs**, by default.

Library basis: OSTEP *security-intro*, p. 8 — "fail-safe defaults" and
"complete mediation" (check every access, default to secure);
OSTEP *security-access*, p. 13 (least privilege) and p. 17 (a reference monitor
mediating every access). Files under
`free-library/05-operating-systems/ostep/`.

## What changes

### 1. The patient surface: one explicit list

`api/src/middleware/patient_surface.rs` holds the `(method, route pattern)` pairs a patient
session may call, e.g. `GET /api/patients/{id}/records`. No wildcards. Each
entry is one line, grouped by patient-app screen.

Matching uses actix's own `ResourceDef` over the table of every registered
route, which `api/build.rs` generates from the route attributes. A request
passes only when every route of that method that could take its path is
listed. actix's resource map could not be used: it answers by path alone, and
the first version of the API test caught it letting `GET /api/patients/list`
(staff) through because an earlier non-GET route has the same shape as the
listed `GET /api/patients/{patient_id}`.

The list starts from what the patient app (and the Expo patient app in
`mobile-examples/`) actually calls, as `scripts/unused-endpoints.py` already
resolves it, plus the session plumbing every signed-in user needs: sign-out,
refresh, MFA, `/api/events`, notifications, profile. Each entry is reviewed by
hand; nothing is added just because a route exists.

### 2. One middleware enforces it

`middleware/patient_surface.rs`, wrapped once in `main.rs`:

* Applies when the request carries a valid access token **and** the caller is a
  patient. "Patient" means the server-side user record's role is `Patient`
  (never the token's informational `role` claim), **or** the token's context is
  `patient`.
* If the `(method, path)` is not on the list, it answers
  `403 PATIENT_SURFACE_ONLY` and the handler never runs. The refusal is logged
  with the user id, method and path pattern (no PHI), and counted as a 403 by
  the existing `http_requests_total` metric, because a patient token at a staff endpoint is either a bug or an attack.
* Unauthenticated routes (sign-in, health, emergency card, public NFC lookup)
  and staff sessions are untouched.
* It sits **inside** CORS, so a refusal still reaches the browser readably, and
  **after** the `/api/v1` rewrite, so both spellings are matched.

Handler-level checks stay. This is a second wall in front of them, not a
replacement.

### 3. Gates so it cannot drift

* **API test:** for every registered route, a patient token is refused unless the
  route is on the list, and a listed route is never refused by the middleware.
  A new staff endpoint is therefore closed to patients on the day it is added,
  without anyone remembering to close it.
* **`scripts/check-patient-surface.py`, in CI:**
  * every endpoint the patient app calls is on the list (otherwise the patient
    app would break in production);
  * every listed entry is a real registered route (no stale entries).
* **Live:** role journeys (patient section), cross-role qualification and the
  patient-app Playwright suite must pass unchanged. Those prove the patient app
  still works and staff work is untouched.

## Edge cases decided

* **A staff member who is also a patient** keeps full access through the hospital
  portal with their staff login. A token issued in the `patient` context is
  limited like any patient's.
* **Shared endpoints** (messaging, notifications, appointments) stay on the list.
  The handlers still scope them to the caller's own records.
* **Guardians** acting for a dependant are patients; their routes must be on the
  list. The guardianship screens are checked explicitly.

## Not in step 1

Separate web addresses for the two apps, network restriction of the hospital
portal, and separate API deployments are steps 3–4, after the patient-app
redesign.

## Effort and order

1. Build the list from the caller scan and review it (half a day).
2. Middleware and API test (half a day).
3. Gate in CI; full `cargo test`; journeys, cross-role and patient Playwright on a
   throwaway database (the build starts cold after the `target` clean).

Rough total: 1–1.5 days, most of it verification.
