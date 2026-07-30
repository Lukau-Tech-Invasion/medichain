# MediChain Architecture

© 2025–2026 Lukau Invasion (Pty) Ltd. All rights reserved.

**Last verified against the codebase: 2026-07-29.** Every count in this document
is reproducible — see [Verifying these numbers](#verifying-these-numbers).

This document follows the [C4 model](https://c4model.com/): system context, then
containers, then components, then the sequences that matter. Diagrams are Mermaid
so they render natively on GitHub with no external assets and stay diffable in
review.

Architecture *decisions* — the reasoning behind these structures, and the options
rejected — live in [`docs/adr/`](adr/).

---

## Table of contents

- [1. System context (C4 L1)](#1-system-context-c4-l1)
- [2. Containers (C4 L2)](#2-containers-c4-l2)
- [3. API components (C4 L3)](#3-api-components-c4-l3)
- [4. The emergency path](#4-the-emergency-path)
- [5. Where data lives, and why](#5-where-data-lives-and-why)
- [6. Consent and lawful basis](#6-consent-and-lawful-basis)
- [7. Retention lifecycle](#7-retention-lifecycle)
- [8. Core data model](#8-core-data-model)
- [9. Trust boundaries](#9-trust-boundaries)
- [10. Quality attributes and constraints](#10-quality-attributes-and-constraints)
- [Verifying these numbers](#verifying-these-numbers)

---

## 1. System context (C4 L1)

Who uses MediChain and what it depends on.

```mermaid
graph TB
    PARAMEDIC["First responder<br/>needs 4 facts in &lt;3s"]
    CLINICIAN["Clinician<br/>doctor · nurse · lab · pharmacy"]
    PATIENT["Patient<br/>owns and grants access"]
    ADMIN["Administrator<br/>accounts · holds · retention"]

    MC["<b>MediChain</b><br/>National health ID and<br/>emergency medical records"]

    NID["National ID registries<br/>Fayda · Ghana Card · NIN<br/>Smart ID · Huduma Namba"]
    SMS["SMS gateway<br/>Africa's Talking"]
    CHAIN["Substrate chain<br/>audit and integrity anchor"]
    IPFS["IPFS<br/>encrypted document store"]

    PARAMEDIC -->|"taps NFC card"| MC
    CLINICIAN -->|"records care"| MC
    PATIENT -->|"grants / withdraws consent"| MC
    ADMIN -->|"governs"| MC

    MC -->|"verify identity<br/>(stub fallback if absent)"| NID
    MC -->|"notify"| SMS
    MC -->|"anchor hashes"| CHAIN
    MC -->|"store encrypted blobs"| IPFS
```

Every external dependency is **optional at runtime**. Absent a national-ID API
key the verifier falls back to a stub and reports `verification_method: Stub`
rather than implying a verification happened. Absent a chain the API records a
deterministic placeholder hash and reports `finalized: false`. This is what makes
the system demonstrable on a laptop with no credentials, and it is deliberate —
a clinical system that cannot function when a third party is down is not a
clinical system.

---

## 2. Containers (C4 L2)

```mermaid
graph TB
    subgraph client["Client tier — React 18 + Vite + Zustand, PWA"]
        DP["<b>doctor-portal</b><br/>151 pages<br/>:5173"]
        PA["<b>patient-app</b><br/>53 pages<br/>:5174"]
        SH["<b>shared</b><br/>typed API client · hooks · types"]
        DP --- SH
        PA --- SH
    end

    subgraph api["API tier — Rust 1.97 · Actix-web 4 · :8080"]
        MW["<b>Middleware stack</b><br/>signature auth · RBAC · rate limit<br/>idempotency · versioning · metrics"]
        HAND["<b>Handlers</b><br/>385 registered routes"]
        DOM["<b>Domain services</b><br/>emergency capsule · consent<br/>retention · federation · telehealth"]
        REPO["<b>Repository traits</b><br/>one interface, two implementations"]
    end

    subgraph data["Data tier"]
        MEM[("<b>In-memory</b><br/>default · ephemeral")]
        PG[("<b>PostgreSQL 16</b><br/>38 migrations → 179 tables")]
        IPFSN[("<b>IPFS (kubo)</b><br/>ChaCha20-Poly1305 blobs")]
    end

    subgraph chain["Blockchain tier — polkadot-sdk"]
        RT["<b>runtime</b><br/>construct_runtime!"]
        P1["pallet-access-control<br/>21 tests"]
        P2["pallet-medical-records<br/>19 tests"]
        P3["pallet-patient-identity<br/>12 tests"]
        ND["<b>node</b><br/>chain spec · service · RPC"]
        RT --- P1
        RT --- P2
        RT --- P3
        ND --- RT
    end

    SH -->|"HTTPS / JSON"| MW
    MW --> HAND --> DOM --> REPO
    REPO --> MEM
    REPO --> PG
    DOM --> IPFSN
    DOM -->|"subxt · signed extrinsics"| ND
```

### Why two storage backends

The in-memory backend is not a toy. It is the default, it implements the same
`repositories::traits` interfaces as PostgreSQL, and it is what makes the system
runnable with a single command for a demo or an evaluation. PostgreSQL is the
production path. Both are exercised by the same test suite.

The cost of that choice is real and was paid during testing: the two
implementations can drift. A double-revoke bug existed in the in-memory capsule
repository while PostgreSQL correctly refused it — the guard lived in SQL rather
than in the trait contract. See [ADR-0001](adr/0001-dual-storage-backends.md).

---

## 3. API components (C4 L3)

```mermaid
graph LR
    REQ(["HTTP request"]) --> SEC["security_headers"]
    SEC --> VER["versioning<br/>/api/v1"]
    VER --> RL["rate_limit"]
    RL --> AUTH["signature_auth<br/>Sr25519 · JWT · X-User-Id"]
    AUTH --> IDEM["idempotency"]
    IDEM --> ROUTE{"route dispatch<br/>385 services"}

    ROUTE --> GEN["handlers/<br/>general · rbac · vitals<br/>emergency_access · retention_admin"]
    ROUTE --> CLIN["clinical_endpoints/<br/>emergency · surgical · workflow<br/>engagement · medical_id · platform"]

    GEN --> SVC["Domain layer"]
    CLIN --> SVC

    SVC --> EC["emergency_capsule<br/>commit · verify · revoke · log"]
    SVC --> RET["retention<br/>evaluator · job · execution"]
    SVC --> LB["types::legal_basis<br/>POPIA §11/§32/§35 · Children's Act §129"]
    SVC --> BC["blockchain<br/>subxt or placeholder"]

    EC --> RP[("repositories")]
    RET --> RP
    LB --> RP
```

**Structural note — authorization is per-handler.** Authentication is
centralised in middleware; role and ownership checks are made in each handler.
Live testing during the internal assessment confirmed those checks hold:
cross-patient IDOR attempts against patient records and vitals returned 403, and
of the 386 handlers, every one authenticates, authorizes, or is a justified
public route. A static scan initially suggested dozens were "open"; probing the
running server with no credentials reduced that to one real bug
(`simulate-nfc-tap`, since fixed and demo-gated — HZ-019) plus one open compute
endpoint (`translate`, since gated).

So the per-handler pattern is not a present vulnerability. Its weakness is
maintainability: without a single chokepoint, a *new* handler can forget to
check. That gap is closed at build time by `scripts/check-endpoint-auth.py`,
wired into CI as a hard gate — a new handler with no auth decision, and not on
the justified allowlist, fails the build. A runtime chokepoint refactor across
all 386 handlers remains a possible future hardening, but the enforceable
invariant now exists without it.

---

## 4. The emergency path

This is the sequence the product exists for. Note what is **absent**: no patient
interaction, no chain round-trip, no decryption key held by the patient.

```mermaid
sequenceDiagram
    autonumber
    actor P as Paramedic
    participant D as Approved device
    participant API as MediChain API
    participant G as Emergency grants
    participant DB as Postgres / memory
    participant L as Access log

    P->>D: Tap patient NFC card
    D->>API: POST /api/emergency/nfc/token (card hash)
    API->>API: Validate card, mint short-lived signed token
    Note over API: The card UID never rotates, so it is<br/>exchanged for an expiring token rather<br/>than accepted as a credential itself
    API-->>D: Short-lived token

    D->>API: POST /api/emergency/access (token, device, reason)
    API->>API: Require live professional work context
    API->>API: Require device approved for this org + facility
    alt any check fails
        API-->>D: 403 — nothing disclosed
    else all checks pass
        API->>G: Issue grant (scoped, expiring, reason recorded)
        API->>DB: Read emergency capsule (server-key decrypt)
        API->>API: Recompute commitment, compare to stored
        API->>L: Log who · why · when · grant · FIELDS REVEALED · verified?
        API-->>D: Blood type, allergies, contacts,<br/>dnr_actionable, commitment_verified
    end

    Note over P,L: Target: under 3 seconds, no network dependency
```

Two design details worth calling out:

**`dnr_actionable` is returned separately from the raw `dnr_status` flag.** A DNR
reads as actionable only when it is recorded, verified, *and* not revoked. An
unverified or withdrawn directive reads as "resuscitate", because wrongly
withholding resuscitation is not a recoverable error.

**A failed integrity check does not withhold the data.** If the stored capsule no
longer matches its commitment, the response still carries the clinical facts and
sets `commitment_verified: false`, and the discrepancy is logged at error level.
A responder who needs a blood type now is not helped by a blank screen; the
investigation happens afterwards.

---

## 5. Where data lives, and why

**No personal health information goes on-chain.** The ledger holds only hashes,
commitments, pointers, public keys and audit entries.

| Data | Location | Rationale |
|---|---|---|
| Emergency capsule (blood type, organ donor, DNR + provenance) | PostgreSQL, encrypted under the **server** keyring | Must be readable in an emergency without the patient online to approve a decryption |
| Capsule commitment + version | On-chain | 32-byte digest makes off-chain tampering detectable without publishing the values |
| Clinical documents | IPFS, ChaCha20-Poly1305 | Content-addressed, encrypted at rest |
| IPFS content hash | On-chain | Proves the document has not been swapped |
| Queryable clinical data | PostgreSQL | Needs indexes, joins, reporting — a ledger cannot serve this |
| National ID | Keyed digest only | Never stored in the clear; keyed so digests are not brute-forceable |
| Access audit entries | PostgreSQL + on-chain | Off-chain for query, on-chain for immutability |

```mermaid
flowchart LR
    subgraph offchain["Off-chain — correctable, deletable"]
        CAP["Emergency capsule<br/>(encrypted, versioned, revocable)"]
        DOC["Clinical documents<br/>(encrypted in IPFS)"]
        CLIN["Queryable clinical data"]
    end

    subgraph onchain["On-chain — immutable, therefore no PHI"]
        COMMIT["commitment: [u8; 32]<br/>version: u32"]
        IHASH["IPFS content hash"]
        AUD["audit entries"]
    end

    CAP -->|"SHA3-256, domain-separated,<br/>length-prefixed"| COMMIT
    DOC -->|"content hash"| IHASH
    CLIN -.->|"access events"| AUD
```

This split is the direct consequence of a legal finding: an immutable ledger
cannot satisfy POPIA's correction, deletion and retention-limitation duties, and
pseudonymity does not cure it because an account may later correlate to a real
person. Plaintext `blood_type` / `organ_donor` / `dnr_status` were therefore
removed from pallet storage in favour of a commitment.
See [ADR-0004](adr/0004-commitment-not-plaintext-on-chain.md).

---

## 6. Consent and lawful basis

A `consent_recorded: true/false` boolean is legally insufficient. POPIA §11
recognises multiple lawful grounds beyond consent, health data additionally needs
a §32 authorisation, and a minor's information layers §34/§35 on top of that —
while the Children's Act governs treatment consent separately.

```mermaid
flowchart TD
    START(["POST /api/consent/sign"]) --> ACCESS{"Caller authorised for<br/>this patient?"}
    ACCESS -->|no| DENY403["403 — a provider may not<br/>consent on a patient's behalf"]
    ACCESS -->|yes| RESTRICT{"Patient under<br/>processing restriction?"}
    RESTRICT -->|yes| DENY_R["403 PROCESSING_RESTRICTED"]
    RESTRICT -->|no| AGE["Resolve age from<br/>date of birth"]

    AGE --> CAP{"Claimed capacity"}

    CAP -->|"child_over_12_mature"| C12{"Age ≥ 12?"}
    C12 -->|no| E1["400 CHILD_SELF_CONSENT_AGE_NOT_MET"]
    C12 -->|yes| MAT{"Maturity assessment<br/>recorded?"}
    MAT -->|no| E2["400 CHILD_MATURITY_ASSESSMENT_REQUIRED"]
    MAT -->|yes| OK

    CAP -->|"self"| SELF{"Age ≥ 12?"}
    SELF -->|no| E3["400 COMPETENT_PERSON_REQUIRED"]
    SELF -->|yes| OK

    CAP -->|"guardian / competent_person / legal_proxy"| EV{"Verified guardian<br/>relationship on file?"}
    EV -->|no| E4["400 GUARDIAN_AUTHORITY_EVIDENCE_REQUIRED"]
    EV -->|yes| OK

    OK["Record: §11 ground · §32 authorisation<br/>child ground · capacity · evidence id<br/>privacy-notice version · scope · expiry"] --> DONE(["201 Created"])
```

A mature child's own consent is recorded as `s129_mature_child_self_consent`,
**not** as competent-person consent — "the child consented" and "a guardian
consented" are different legal facts and must not collapse into one flag.

---

## 7. Retention lifecycle

Retention *evaluates* and *restricts*. It does not delete. That boundary is
deliberate: the retention periods await formal legal confirmation, so the first
thing built on top of them is reversible.

```mermaid
stateDiagram-v2
    [*] --> Evaluated: daily job / on-demand report

    Evaluated --> Incomplete: policies or holds unreadable
    Incomplete --> [*]: 503 — never reported as success

    Evaluated --> Pending: request approval<br/>(token bound to SHA3-256 digest<br/>of THIS assessment)

    Pending --> Rejected: operator declines
    Pending --> Approved: operator approves
    Rejected --> [*]

    Approved --> Expired: 24h elapsed
    Expired --> [*]

    Approved --> Executing: execute
    Executing --> Aborted: record set drifted<br/>(digest mismatch)
    Executing --> Aborted: legal holds unreadable
    Aborted --> [*]

    Executing --> Restricted: processing limited to storage<br/>+ deletion-register entry
    Restricted --> Lifted: administrator lifts
    Lifted --> [*]
    Restricted --> [*]

    note right of Restricted
        No destructive DELETE is issued.
        Irreversible disposal, cascade,
        backup expiry and cryptographic
        erasure are NOT implemented.
    end note
```

The digest binding is the load-bearing control: without it, approving a report of
three records could execute against three thousand, and the approval would be
genuine but meaningless.

---

## 8. Core data model

The emergency and compliance tables — the ones this architecture turns on. The
full schema is 179 tables; see [`database-schema.md`](database-schema.md).

```mermaid
erDiagram
    patients ||--o{ emergency_capsules : "versioned"
    patients ||--o{ emergency_capsule_access_log : "disclosures"
    patients ||--o{ consent_records : "lawful basis"
    patients ||--o{ guardian_relationships : "authority"
    patients ||--o{ legal_holds : "may suspend disposal"
    patients ||--o{ processing_restrictions : "POPIA restriction"
    retention_approvals ||--o{ processing_restrictions : "authorises"
    retention_approvals ||--o{ deletion_register : "evidences"

    patients {
        varchar id PK
        varchar national_id_hash "keyed digest"
        bytea profile_extras_encrypted
        int key_version
    }
    emergency_capsules {
        varchar patient_id PK
        int version PK "strictly increasing"
        char commitment "SHA3-256 hex, on-chain"
        bytea capsule_encrypted "server keyring"
        timestamptz revoked_at "revocation is not deletion"
        boolean chain_finalized "false = placeholder"
    }
    emergency_capsule_access_log {
        varchar id PK
        varchar accessed_by
        varchar reason_code
        text_array fields_revealed "field-level disclosure"
        boolean commitment_verified
    }
    consent_records {
        varchar id PK
        varchar popia_section_11_basis
        varchar special_information_basis
        varchar child_information_basis
        varchar consent_giver_capacity
        text child_maturity_assessment
    }
    retention_approvals {
        varchar token PK
        char assessment_digest "binds to one assessment"
        varchar status
        timestamptz expires_at
    }
    deletion_register {
        varchar id PK
        varchar action "restricted"
        text basis "no clinical payload"
    }
```

---

## 9. Trust boundaries

```mermaid
flowchart TB
    subgraph untrusted["Untrusted"]
        BROWSER["Browser / PWA"]
        CARD["NFC card / QR"]
    end

    subgraph semi["Semi-trusted — authenticated but constrained"]
        DEVICE["Approved work device"]
        STAFF["Authenticated clinician"]
    end

    subgraph trusted["Trusted — server side"]
        APIS["API process<br/>holds encryption keyring"]
        DBS[("PostgreSQL")]
    end

    subgraph external["External — outside our control"]
        NIDX["National ID APIs"]
        SMSX["SMS gateway"]
        NODEX["Chain nodes<br/>possibly foreign"]
    end

    BROWSER -->|"TLS · never trusted for role claims"| APIS
    CARD -->|"exchanged for expiring token"| APIS
    DEVICE --> APIS
    STAFF --> APIS
    APIS --> DBS
    APIS -->|"no PHI crosses this line"| NIDX
    APIS -->|"no PHI crosses this line"| SMSX
    APIS -->|"hashes only"| NODEX
```

Rules that hold at every boundary:

1. **Roles come from the server-side user record, never from a client header
   claim.** `X-User-Id` identifies; it does not authorise.
2. **No PHI crosses into an external system.** National-ID calls send a digest;
   SMS carries no clinical content; the chain receives hashes.
3. **Cross-border replication is a live compliance question.** Chain nodes may
   run outside South Africa, which POPIA treats as a transborder transfer
   requiring assessment — tracked in
   [`GOVERNANCE_RECORD.md`](GOVERNANCE_RECORD.md).

---

## 10. Quality attributes and constraints

| Attribute | Target | How it is achieved |
|---|---|---|
| **Emergency latency** | < 3 s, offline | Local read, no chain call, no patient round-trip |
| **Safety** | NASA Power of 10 | No recursion, bounded loops, functions ≤ 60 lines, assertions on invariants |
| **Confidentiality** | Encrypted at rest | ChaCha20-Poly1305 AEAD, Argon2id KDF, keyring versioning for rotation |
| **Integrity** | Tamper-evident | SHA3-256 commitments, domain-separated and length-prefixed so no two distinct inputs share a digest |
| **Injection resistance** | Zero string-built SQL | `sqlx` with bound parameters only |
| **Auditability** | Field-level | Every emergency disclosure records which fields were shown |
| **Availability** | Degrade, don't fail | Every external dependency optional; chain/ID failures are non-fatal and honestly reported |

### Deliberate non-goals

- **Not** a general EHR replacement. The emergency subset is the wedge.
- **Not** a public ledger of health data. If it must be correctable, it is off-chain.
- **Not** claiming production readiness for real patient data — seven gates
  block that, four of which no code can close.

---

## Verifying these numbers

```bash
# HTTP handlers and registered routes
grep -rhoE '#\[(get|post|put|patch|delete)\("' --include=*.rs api/src | wc -l   # 386
grep -c '\.service(' api/src/routes.rs                                          # 385

# Migrations, and tables in a migrated database
ls api/migrations/*.sql | wc -l                                                 # 38
psql -tAc "SELECT count(*) FROM information_schema.tables
           WHERE table_schema='public';"                                        # 179

# Frontend pages
find client/doctor-portal/src/pages -name '*.tsx' | wc -l                       # 151
find client/patient-app/src/pages   -name '*.tsx' | wc -l                       # 53

# Tests
cargo test -p medichain-api --bin medichain-api                                 # 305
for p in access-control medical-records patient-identity; do
  cargo test -p pallet-$p 2>&1 | grep 'test result'; done                       # 21, 19, 12
cargo test -p medichain-crypto 2>&1 | grep 'test result'                        # 23
bash scripts/synthetic-e2e-test.sh                                              # 40 assertions
```

---

## Related documents

| Document | Purpose |
|---|---|
| [`adr/`](adr/) | Architecture Decision Records — the *why* |
| [`api.md`](api.md) / [`openapi.yaml`](openapi.yaml) | Endpoint reference and machine-readable spec |
| [`database-schema.md`](database-schema.md) | Full schema |
| [`PRODUCTION_READINESS_GATES.md`](PRODUCTION_READINESS_GATES.md) | What blocks real patient data |
| [`../SECURITY.md`](../SECURITY.md) | Security posture and disclosure policy |
| [`TECHNICAL_DEBT_REGISTER.md`](TECHNICAL_DEBT_REGISTER.md) | Known debt, deferred deliberately |
| [`BLOCKCHAIN_OPERATIONS.md`](BLOCKCHAIN_OPERATIONS.md) | Node and chain operations |
| [`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md) | Incident playbook |
