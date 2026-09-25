# MediChain qualification campaign — 2026-08-26

Evidence-driven pass over authentication, authorization, durability and
supply-chain, run against the real repository, a live API and a real PostgreSQL
database. Everything below was executed; nothing is carried over from an earlier
document.

## A. Release decision

| Target | Verdict | Why |
| --- | --- | --- |
| **LOCAL DEMO** | **GO** | Sign-in, clinical read, patient registration and role separation all work and are proven end to end. |
| **CLINIC DEMO** | **CONDITIONAL** | Fine for a supervised walkthrough on synthetic data. Session restore returns the user to sign-in on every reload, which is safe but will be noticed. |
| **CONTROLLED PILOT** | **NO-GO** | Four of seven roles have never been exercised, consent revocation and maker-checker are unproven end to end, and the release artifact has no source-to-image provenance. |
| **PRODUCTION** | **NO-GO** | The bar in `docs/` requires a complete IDOR matrix, proven consent governance, qualified external boundaries and independent security review. Several of those lanes have not started. |

The honest summary: **the authentication spine is now genuinely strong and
proven at runtime. Most of the rest of the system is still asserted rather than
demonstrated.**

## B. What was found and fixed

Every item below was reproduced first, then fixed, then re-verified.

### 1. Authenticated state without a session (critical)

Not a missing route — an authentication-state-machine defect with four
compounding faults:

* `login()` opened with `GET /api/auth/wallet/{address}`, deliberately removed
  because it disclosed `name`, `role`, `username` and `linked_patient_id` for any
  address with **no authentication**. Two callers never migrated, so every wallet
  sign-in 404ed and blamed the account: *"Wallet not registered"* for accounts
  that were registered.
* `acquireJwtTokens` returned `void` and swallowed every failure, including "no
  signer supplied".
* Callers set `isAuthenticated: true` **before** asking for a token.
* The idempotency middleware refuses any keyed mutation without an authenticated
  subject — and sign-in is subjectless by definition, so the credential path
  could not have worked either.

The product was a session the UI believed in, holding no bearer token, whose
every request fell back to the caller-controlled `X-User-Id` header.

**Fixed.** Token acquisition is authoritative and returns success; no caller
enters an authenticated state without it. `login()` proves control of the key
and reads identity from `/api/auth/me` — authentication proves who you are
rather than asking first. `restoreSession` fails closed. Identity-establishing
endpoints skip subject-keyed idempotency through an explicit allowlist, because a
rule like *"skip when no subject is present"* would let any caller opt out by
omitting credentials.

### 2. Quick login rebuilt on the real credential path

It now fetches seeded fixture credentials from a demo-gated resolver and runs
the ordinary employee-ID/password flow: keystore unlocked, signer derived,
challenge signed, genuine session issued. One authentication path with a
convenience in front of it, not a second protocol.

Containment does not rely on hiding a button. `GET /api/auth/demo-credentials`
requires `MEDICHAIN_DEV_MODE` **and** demo mode, both defaulting to off, and
offers an explicit fixture allowlist rather than any account holding a keystore.
No fixture password ships in the bundle.

### 3. Patient accounts removed from the clinician portal

A patient signs in through the patient app. Offering them here invited a
staff-facing session for someone whose only permitted view is read-only access to
their own record.

### 4. Session split, revocation enforcement, Class B/C authorization

Covered in the ADR-0008 entries of the remediation ledger; all committed and
proven earlier in this campaign.

## C. Evidence

### Runtime — authentication (headed browser, live API, real PostgreSQL)

| Check | Result |
| --- | --- |
| Quick login chain | `staff/login` → `challenge` → `jwt` → `me`, all **200**, lands on `/dashboard` |
| Every app request after sign-in | `Authorization: Bearer`; **zero** `X-User-Id` |
| Bare `fetch` with no headers | **401** — no ambient authentication |
| Hard reload | returns to sign-in; no tokenless session reconstructed |
| `MEDICHAIN_DEV_MODE` unset | resolver **403**, demo-login **403**, wallet route **404**, section absent |

### Authorization matrix

Two genuinely distinct role sessions, each obtained through the full
credential → keystore → signer → challenge → JWT flow.

| Probe | Doctor | Nurse |
| --- | --- | --- |
| Patient list / detail / prescriptions | 200 | 200 |
| Admin dashboard | **403** | **403** |
| Staff directory | **403** | **403** |
| Security alerts | **403** | **403** |
| Retention register | **403** | **403** |
| Role revocation | **403** | **403** |

Object-reference attacks all fail closed with no disclosure: fabricated patient
id → 404; SQL-quoted id → 404; path traversal (`..%2F..%2Fusers`) → 404.
Break-glass cannot be minted from a patient id — `/api/emergency/access`
requires `nfc_tag_id`, binding it to physical card possession.

### Durability and idempotency

| Check | Result |
| --- | --- |
| Register → kill API → restart → read back | **survives**, encrypted fields decrypt correctly |
| Same key, same body, twice | first 201, second `IDEMPOTENCY_DUPLICATE` |
| Rows actually created | **exactly one**, verified by reading the roster |
| Same key, different body | `IDEMPOTENCY_KEY_REUSED` — key bound to a request digest |

### Privacy

Zero occurrences of patient names, patient IDs or the fixture password in API
logs or `/metrics`, tested with markers written moments earlier.

### Test suites (re-run on this source, not carried over)

| Suite | Result |
| --- | --- |
| API, nothing filtered | **491 passed, 0 failed, 1 ignored** (995.62s) |
| Clinician portal | 85 files / 321 tests |
| Patient app | 26 files / 83 tests |
| Typechecks | shared, clinician, patient — all pass |
| `cargo fmt --check`, `clippy --all-targets -D warnings` | clean |
| Repo gates | endpoint-auth, write-auth, state-durability, legacy-identity, workflow lint — all pass |

The API suite grew 486 → 491 across this pass; every Postgres test ran (nothing
filtered out), which is what makes the durability and authorization evidence
above meaningful rather than partial.

### Supply chain

`cargo deny check` → `advisories ok, bans ok, licenses ok, sources ok`.

## D. Things I got wrong, and how they were caught

Recorded because each would have produced a false pass:

* **Two race tests proved nothing.** `tokio::join!` versions passed three times
  against deliberately unfixed code. Replaced with a `FOR UPDATE NOWAIT`
  lock-contention test, verified to fail without the fix.
* **A gate "fix" that changed nothing.** New auth markers were first added to
  `AUTH_MARKERS`, a list `classify()` never reads. Only the gate continuing to
  fail surfaced it.
* **A CRLF-corrupted signature.** Python's text-mode write turned `\n` into
  `\r\n`, so the message signed was not the message the server built. **The
  server was right to refuse it.** Had the digest been over a re-serialised
  object rather than exact bytes, this class of failure would be intermittent
  and nearly undiagnosable — the argument for byte-exact digests, demonstrated
  by accident.
* **Two tests asserting the defect.** `authStore` tests asserted that `login`
  fetched the removed wallet route and authenticated on any 200, and passed
  throughout by mocking the very fetch that was wrong.

## E. Remaining blockers, by kind

**Code / design decision (owner)**
* Session restore cannot restore. Needs durable session material: a persisted
  refresh token (storage exposure) or a cookie-borne session (CSRF surface).
* Idempotent retry returns an error rather than the original response, so a
  client whose response was lost cannot recover its result from the retry.
  Exactly-once is satisfied; response replay is not.
* No Class C requirement is attached to any real clinical mutation. The
  mechanism is complete and reachable; the matrix naming which handlers demand
  Class B or C is clinical governance.

**Missing fixtures (blocks testing, not a defect)**
* Only Doctor, Nurse and Admin fixtures are seeded. Pharmacist, Lab Technician
  and Emergency Responder cannot be exercised until fixtures exist.

**Not started**
* Consent grant/revocation end to end; maker-checker self-approval; full
  cross-role clinical workflow; accessibility; performance and SLOs; backup and
  restore; observability chain; CI provenance and SBOM.

**Open owner decisions carried forward**
* `blockchain/Cargo.toml` declares MIT while `medichain-node` links 17 strict
  GPL-3.0-only crates. The proprietary root LICENSE narrows the options rather
  than widening them.
* CDLA for `webpki-roots` is accepted narrowly; third-party notices must carry
  the text.

## F. Evidence gaps — stated, not concealed

* Nothing here covers Pharmacist, Lab or Emergency sessions.
* Cross-organisation isolation was not probed: ADR-0007 makes this a
  single-organisation deployment, so there is no second organisation to cross.
  The right test is that a second active organisation fails closed at startup,
  which was not run.
* Process termination *between* the business commit and the idempotency
  completion is untested; it needs a fault-injection hook that does not exist.
* The blockchain lane is untouched in this pass.
* Docker's daemon became unresponsive twice during the campaign, so some
  database verification was done through the API rather than by direct query.
