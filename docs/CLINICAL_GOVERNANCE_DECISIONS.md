# Clinical governance decisions required before two workflows can be built

**Status: OPEN. Nothing here can be closed by writing code.**

Two workflows in MediChain are blocked not on engineering but on clinical
policy. Each has enum states, UI surface, or a data model that *implies* a
behaviour nobody has decided. Implementing them from the code alone would put a
clinical rule into a health record system that no clinician chose, which is the
one thing this campaign will not do.

This document exists so the blockage is actionable rather than merely recorded.
Each section states what the code actually contains today, then the questions a
qualified clinical or pharmacy authority must answer. The engineering work is
small once the answers exist; the answers are not engineering.

Ledger references: `SCR-013` (pharmacist dispensing), `SCR-009b` (specimen
recollection), in `docs/REMEDIATION_LEDGER_2026-08-22.md`.

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

## 2. Specimen recollection (SCR-009b)

### What the code contains today

`SpecimenRejection` (`api/src/clinical.rs:5351`) carries
`rejection_id`, `accession_number`, `patient_id`, `test_ordered`,
`rejection_reason`, `rejection_details`, `recollection_required: bool`,
`provider_notified: bool`, `notification_time`, and `disposed`.

So the model records **that** a recollection is required. It records nothing
about a recollection actually happening: no link from a rejected specimen to a
replacement, no new accession number, no request state.

Notify is a separate, working workflow and was completed earlier in this
campaign (`POST /api/clinical/specimen-rejection/{id}/notify`, which resolves
the ordering provider through the specimen's submission). **Recollect must not
be collapsed back into it** — telling a provider a specimen failed and
obtaining a replacement sample from a patient are different acts with different
consequences.

### Decisions required

1. Who may request a recollection — the laboratory that rejected the specimen, the ordering provider, or either?
2. Is the rejected specimen record immutable once rejected, or may it be amended?
3. Does recollection create a new specimen, a new collection event, a new submission, or a child record of the original?
4. How is lineage to the rejected specimen preserved, and must it remain visible on the replacement result?
5. Is a new accession number issued, or is the original reused?
6. Must the ordering provider approve a recollection the laboratory requests?
7. How and when is the patient notified that they must attend again?
8. May a recollection request be cancelled, and by whom?
9. What happens when the same rejection receives two recollection requests — refusal, or idempotent no-op?
10. What guarantees exactly-once behaviour if a request is retried?
11. What audit vocabulary do these transitions use? (Same CHECK-constraint gate as above.)
12. Does the original rejection remain permanently visible on the patient's record once a replacement succeeds?

### Interim UI obligation

Whatever is decided, **a dead affordance must not ship**. Until this is
answered, any Recollect control must be absent or visibly disabled with a
reason, never a button that appears actionable and does nothing.

---

## How to close these

An answer is not "the code should do X". It is a decision by someone
accountable for clinical or pharmacy practice in the deploying jurisdiction,
recorded with their name and date, in the restricted governance store described
in `docs/GOVERNANCE_RECORD.md`. This file then references that record; it does
not contain it.
