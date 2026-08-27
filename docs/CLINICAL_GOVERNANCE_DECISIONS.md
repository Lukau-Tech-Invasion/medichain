# Clinical governance decisions MediChain cannot make for itself

**Status: OPEN. Nothing here can be closed by writing code.**

Two of the three items recorded here have been answered and built; their
sections are kept as a record of what was decided, so the next reader can see
that each rule was chosen rather than inherited from the shape of an enum.

One remains genuinely open: break-glass behaviour when the audit store is
unavailable, where the safer choice for the record is the less safe choice for
the patient. Two narrower questions also remain inside the dispensing section --
controlled-substance handling and second-pharmacist verification.

Deciding any of those from the code alone would put a clinical rule into a
health record system that no clinician chose, which is the one thing this
campaign will not do.

This document exists so the blockage is actionable rather than merely recorded.
Each section states what the code actually contains today, then the questions a
qualified clinical or pharmacy authority must answer. The engineering work is
small once the answers exist; the answers are not engineering.

Ledger references: `SCR-013` (pharmacist dispensing), `SCR-009b` (specimen
recollection), in `docs/REMEDIATION_LEDGER_2026-08-22.md`. Section 3 arose from
the emergency break-glass audit work of 2026-08-27.

---

## 1. Pharmacist dispensing (SCR-013) — ANSWERED AND BUILT 2026-08-27

The twenty questions below were answered in the completion brief. The
implementation is `SCR-013b` in the remediation ledger.

The decisive fact that used to block this: `PrescribedMedication` already
carried `quantity` and `quantity_unit`, so what was prescribed was modelled —
what was missing was the *dispensed* side. `EPrescription.dispensed_quantity`
now carries the running total, and `dispense_events` carries the history.

| Question | Decision |
| --- | --- |
| Who may receive / dispense | Pharmacist only. An administrator may also correct. |
| Transmitted → Received | An explicit act by the receiving pharmacy, not automatic. |
| Dispensing from other states | Refused: only Received, InProgress or PartialFill. |
| What `Dispensed` means | The full prescribed quantity has left the pharmacy. |
| How quantity is recorded | Per event, in `dispense_events`, with a running total on the prescription. |
| What `PartialFill` retains | The remainder, derived from prescribed minus dispensed. |
| Repeat partial fills | Permitted until the remainder reaches zero, at which point the state becomes Dispensed. |
| Over-dispensing | Refused, and impossible under concurrency: the transition is guarded on the running total. |
| Reversal | Permitted with a mandatory reason, audited, and it never deletes the original event. |
| Concurrent dispensing | Exactly one of six simultaneous whole-quantity attempts succeeds. |
| Audit | Five new actions, added to the CHECK constraint and the source-derived gate. |

**Still open, and deliberately not guessed:** controlled-substance handling
beyond the existing `is_controlled` flag (additional identity checks, register
entries, quantity limits, whether partial fills are permitted at all), and
whether a second pharmacist must verify anything. Neither has a stated policy,
and both are the kind of rule that must come from a pharmacy authority rather
than from the shape of an enum.

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
