# Clinical governance decisions MediChain cannot make for itself

**Status: OPEN. Nothing here can be closed by writing code.**

Three items are blocked not on engineering but on clinical policy. Two are
workflows that cannot be built: each has enum states, UI surface, or a data
model that *implies* a behaviour nobody has decided. The third is a tradeoff
already shipped as a default, where the safer choice for the record is the less
safe choice for the patient. Deciding any of them from the code alone would put
a clinical rule into a health record system that no clinician chose, which is
the one thing this campaign will not do.

This document exists so the blockage is actionable rather than merely recorded.
Each section states what the code actually contains today, then the questions a
qualified clinical or pharmacy authority must answer. The engineering work is
small once the answers exist; the answers are not engineering.

Ledger references: `SCR-013` (pharmacist dispensing), `SCR-009b` (specimen
recollection), in `docs/REMEDIATION_LEDGER_2026-08-22.md`. Section 3 arose from
the emergency break-glass audit work of 2026-08-27.

---

## 1. Pharmacist dispensing (SCR-013)

### What the code contains today

`PrescriptionStatus` (`api/src/clinical.rs:7240`) declares eleven states:

```
Draft  Pending  Signed  Transmitted  Received  InProgress
Dispensed  PartialFill  Cancelled  Expired  Error
```

The implemented lifecycle ends at `Transmitted`. **Four states — `Received`,
`InProgress`, `Dispensed`, `PartialFill` — cannot currently be entered by any
endpoint**, and no handler anywhere names `Role::Pharmacist` for a write. A
pharmacist can sign in, see real transmitted prescriptions with the correct
patient, medication and dose, and take no action of any kind. The Pharmacy
Dashboard shows an "Orders to Verify" queue with no action on it and throughput
tiles that can never move.

`EPrescription` carries 23 fields. The ones that bear on these decisions:

| Field | Bearing |
| --- | --- |
| `pharmacy: EPharmacyInfo` | The prescription already names a destination pharmacy, so "may another pharmacy dispense this?" is answerable in the model — but no rule consults it. |
| `is_controlled: bool`, `dea_schedule: Option<String>` | Controlled status is modelled and currently gates nothing at dispense. |
| `refills_allowed: u8`, `refills_remaining: u8`, `last_filled: Option<i64>` | Refill accounting exists across fills. |
| *(absent)* | **No field records a dispensed quantity, or a quantity remaining within a fill.** |

That last row is the decisive one. `PartialFill` is a declared state with
nowhere to record what was partially filled. Supporting it is not a handler —
it requires a model change whose shape depends entirely on the answers below.

### Decisions required

**Authority and receipt**
1. Which role may receive a transmitted prescription? Pharmacist only, or also a pharmacy technician if that role is introduced?
2. Is `Transmitted → Received` an automatic consequence of transmission, or an explicit human act by the receiving pharmacy?
3. May a pharmacist act on a prescription transmitted to a *different* pharmacy (`EPrescription.pharmacy`)? If so, under what circumstances, and is the original pharmacy notified?
4. Who may enter `InProgress`, and does that state have any clinical meaning or is it purely operational?

**What dispensing is**
5. What exactly constitutes `Dispensed` — the medicine leaving the shelf, or being handed to the patient or their agent?
6. Is dispensing the pharmacist's unilateral assertion, or a two-party confirmation involving the patient?
7. How is the quantity actually dispensed recorded, given no field exists for it today?

**Partial fills**
8. What does `PartialFill` mean here: a short supply against one fill, or an owing balance the patient returns for?
9. How is the remaining quantity retained, and against which counter — a new per-fill quantity, or the existing refill counters?
10. May a partial fill be repeated against the same fill, and how many times?
11. What happens when the remaining quantity reaches zero — does the state become `Dispensed`, or does it stay `PartialFill` with a completed balance?

**Correction and reversal**
12. Is reversal or correction of a dispense permitted at all?
13. If so, who may reverse — the dispensing pharmacist only, a supervising pharmacist, or an administrator — and within what window?
14. What happens to a prescription already marked `Transmitted` if the prescriber cancels it afterwards?

**Controlled medicines**
15. Do controlled medicines (`is_controlled`, `dea_schedule`) follow a different path — additional identity checks, register entries, quantity limits, or refusal of partial fills?
16. Is a second pharmacist verification required anywhere, and if so for which classes?

**Downstream obligations**
17. What patient and prescriber notifications are mandatory at each transition?
18. What audit events are mandatory, and with what vocabulary? (`access_logs.action` has a CHECK constraint; `scripts/check-audit-action-vocabulary.py` enforces that handlers only write permitted values, so new actions must be added deliberately.)
19. What is written to the patient's own record when a medicine is dispensed?
20. How must concurrent dispense attempts on one prescription be serialised — first writer wins, or explicit refusal?

### What gets built once answered

Explicit authorization; the legal transition set; an atomic repository
transition guarded inside the write (the maker-checker house pattern, `WHERE
status = $expected`); idempotency; exactly-once dispensing; partial-fill
accounting; the reversal policy; audit; UI; and negative tests for role,
cross-pharmacy, double-submit and concurrent dispense.

---

## 2. Specimen recollection (SCR-009b) — ANSWERED AND BUILT 2026-08-27

The twelve questions below were answered in the completion brief, so this
section is a record of what was decided rather than an open request. The
implementation is `SCR-009c` in the remediation ledger.

What was built, and the decision each choice encodes:

| Question | Decision |
| --- | --- |
| Who may request | The laboratory, the patient's clinicians, or an administrator — the same set the Notify workflow already uses. |
| Is the rejection immutable | Yes. Nothing in this feature writes to `specimen_rejections`. |
| What recollection creates | A separate `specimen_recollection_requests` row referencing the rejection, not an edit of it. |
| How lineage is preserved | `rejection_id` and `original_specimen_id` point backwards; `replacement_specimen_id` points forwards once complete. |
| New accession number | The replacement is a new specimen collection with its own accession; the original keeps its own. |
| Must the provider approve | No. The laboratory that found the problem may act, and Notify tells the provider separately. |
| Patient notification | Out of scope for this slice, and deliberately not faked: no notification is claimed anywhere in the UI or API. |
| Cancellation | Permitted, with a mandatory reason, audited. |
| Duplicate requests | Refused — one open request per rejection, enforced by a partial unique index. |
| Exactly-once | Completion and cancellation are guarded inside the write, so retries return a conflict rather than acting twice. |
| Audit vocabulary | Three new actions, added to the CHECK constraint and to the source-derived gate. |
| Does the rejection stay visible | Yes, permanently, including every abandoned attempt. |

The one thing deliberately **not** built is patient notification, because
nothing in the repository defines how a patient is told to attend again. No UI
or response claims it happened.

---

## 3. Break-glass access when the audit store is unavailable (open tradeoff)

### What changed, and why it needs a decision

`grant_bound_emergency_access` previously wrote its field-level access record
best-effort: the result of `log_access` was discarded, so a failed audit write
lost the record and the disclosure proceeded. That cannot satisfy "every
emergency access is logged and surfaced to the patient", so the handler now
**fails closed** — if the access record cannot be persisted it returns
`503 AUDIT_PERSISTENCE_REQUIRED` and discloses nothing.

That is the right default for an auditable health record. It also has a clinical
cost that belongs to someone other than an engineer:

> With auditing unavailable, a paramedic holding a valid emergency grant is
> refused the patient's blood type, allergies and DNR status.

This is not hypothetical in this codebase. An earlier incident is on record in
which fail-closed audit writes blocked emergency access rather than merely
losing a log line — the in-memory repository enforces no CHECK constraints, so a
vocabulary mismatch that passed everywhere else failed only on PostgreSQL, and
took emergency access down with it.

### Decisions required

1. When the audit store is unavailable, does break-glass access **fail closed** (refuse, current behaviour) or **fail open with a queued record** (disclose, and reconcile the audit entry afterwards)?
2. If fail-open is ever permitted, what compensating control applies — a durable local queue, a hard cap on how long it may run unaudited, or an out-of-band alert to the Information Officer?
3. Does the answer differ between a total audit outage and a single rejected write (for example a constraint violation on one record)?
4. Who is accountable for the decision, and where is it recorded for the regulator?

Until this is answered the code stays fail-closed, because that is the safer
default for the *record*; but note that it is the less safe default for the
*patient in front of the paramedic*, and that asymmetry is exactly why it is not
an engineering call.

---

## How to close these

An answer is not "the code should do X". It is a decision by someone
accountable for clinical or pharmacy practice in the deploying jurisdiction,
recorded with their name and date, in the restricted governance store described
in `docs/GOVERNANCE_RECORD.md`. This file then references that record; it does
not contain it.
