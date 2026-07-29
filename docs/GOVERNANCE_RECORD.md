# Governance Record — POPIA Accountability

**Status: UNFULFILLED.** This document is a template and a checklist, not
evidence. Every item below is outstanding until a named human completes it and
records the evidence in the restricted governance store. Nothing here can be
closed by writing code.

It exists because `docs/PRODUCTION_READINESS_GATES.md` items 5, 6 and 7 are
gate conditions for processing real patient data, and the 2026-07-28 legal
review noted the Information Officer requirement "could not be verified from
the repository — treat as unfulfilled until documentary evidence exists."

> **Do not commit real identifying details to this file.** Identity-document
> numbers, regulator registration certificates, and personal addresses belong in
> a restricted governance store, not in a public repository. This file records
> *that* an appointment exists and *where* its evidence lives — never the
> evidence itself.

---

## 5. Responsible legal entity and Information Officer

For a private body, the head of the body is ordinarily the Information Officer
under the POPIA/PAIA framework, and must be **registered with the Information
Regulator before formally taking up POPIA duties**.

### Record

```json
{
  "organisation": "Lukau Invasion (Pty) Ltd",
  "jurisdiction": "Republic of South Africa",
  "registration_number": "2026/600804/07",
  "registered_with": "Companies and Intellectual Property Commission (CIPC)",
  "registered_on": "2026-07-29",
  "entity_type": "Private company (Pty) Ltd — single director, single shareholder",
  "information_officer": {
    "name": "Rakau Keorapetswe Lucas Kgoatlha",
    "role": "Director / Head of the body — Information Officer by operation of law",
    "business_email": "kkgawatlh9@gmail.com",
    "appointed_at": "NOT YET FORMALLY APPOINTED",
    "regulator_registration_status": "not_started",
    "registration_evidence_location": "none — nothing to evidence yet"
  },
  "deputy_information_officers": []
}
```

**Status: the legal entity now exists; the Information Officer appointment does
not.** Under the POPIA/PAIA framework the head of a private body is ordinarily
the Information Officer, so the role falls to the sole director by default — but
"falls to by default" is not the same as appointed and registered. The officer
must be **registered with the Information Regulator** before formally taking up
POPIA duties, and that registration has not been made.

Treat this item as **unfulfilled** until the registration evidence exists.

### Where the appointment must also be recorded

- [ ] Information Regulator eServices registration
- [ ] Founder / director / board resolution
- [ ] PAIA manual
- [ ] Privacy notice and data-subject contact page
- [ ] Internal POPIA compliance framework
- [ ] Processing-activity register
- [ ] This governance record (pointer only, no identifying details)

**Note on scope (updated 2026-07-30):** the first blocking step — incorporation —
is now done. Lukau Invasion (Pty) Ltd was registered on 29 July 2026. What remains
is the appointment itself and registration with the Information Regulator, plus
recording it in the PAIA manual, the privacy notice, and the processing-activity
register. None of that is an engineering task.

---

## 6. POPIA prior-authorisation and transborder-processing assessment

Two distinct triggers apply, and both need a written assessment before real
data is processed.

### 6a. Prior authorisation

POPIA requires prior authorisation from the Regulator in defined cases,
including where a unique identifier is processed for a purpose other than the
one it was collected for, **with the aim of linking information across
responsible parties**.

MediChain's design makes this a live question rather than a theoretical one:

- A national health ID is issued and used as a cross-facility identifier.
- National ID numbers are verified against external registries
  (`api/src/national_id.rs`) and stored as keyed digests.
- The explicit product goal is linking a patient's records across facilities.

- [ ] Written assessment: does the health-ID scheme constitute processing a
      unique identifier to link records across responsible parties?
- [ ] If yes: prior-authorisation application prepared and submitted
- [ ] Outcome recorded, with the Regulator's reference

### 6b. Transborder processing

The blockchain component is the specific concern. A public — or even a
permissioned but geographically distributed — chain replicates whatever is
on-chain to every node, including nodes outside South Africa.

Current mitigations already in place (recorded so the assessment starts from
facts, not assumptions):

- Emergency plaintext values were removed from chain storage in favour of a
  commitment (Horizon HZ-003; see `api/src/emergency_capsule.rs`).
- Personal identifiers on-chain are keyed digests, not raw values.
- `BLOCKCHAIN_ENABLED` defaults to `false`; the node is a stub.

Still to assess:

- [ ] Where will validator/full nodes physically run?
- [ ] Which of those jurisdictions have an adequate level of protection?
- [ ] Does an on-chain `AccountId`, correlated over time, amount to personal
      information leaving the country? (The legal review already answered the
      adjacent question — pseudonymity does not cure identifiability — so the
      starting assumption should be "yes" until argued otherwise.)
- [ ] Are IPFS pins, backups, or third-party APIs (SMS, national-ID
      verification, model providers) also transborder transfers?
- [ ] Written transborder assessment completed and signed off

---

## 7. South African health/privacy lawyer sign-off

The 2026-07-28 review was substantive and is the basis for
`docs/PRODUCTION_READINESS_GATES.md`, but it is **not** a sign-off on a
production processing model. It answered six scoped questions and explicitly
left the production model blocked.

Sign-off requires a named practitioner reviewing the system as actually built.

- [ ] Practitioner identified and engaged
- [ ] Processing-activity register provided
- [ ] Data-flow and trust-boundary documentation provided
      (`.horizon/02-trust-boundaries.md`)
- [ ] Gate items 1–4 evidence provided (implementation status, not intent)
- [ ] Items 5 and 6 completed first — a lawyer cannot sign off a model with no
      legal entity and no transborder assessment
- [ ] Written sign-off obtained and stored
- [ ] `docs/PRODUCTION_READINESS_GATES.md` updated with the outcome

---

## Sequencing

These are ordered by dependency, not by preference:

1. **Legal entity** — nothing else can be recorded against nothing.
2. **Information Officer appointed and registered** (item 5).
3. **Prior-authorisation and transborder assessments** (item 6).
4. **Lawyer sign-off on the production model** (item 7).

Engineering work on gate items 1–4 can proceed in parallel and does not block
any of the above — but none of the above is unblocked by engineering either.
