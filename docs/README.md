# Documentation Index

© 2025–2026 Lukau Invasion (Pty) Ltd.

Organised by what you are trying to do.

## Start here

| Document | Read it when |
|---|---|
| [`../README.md`](../README.md) | You want to know what MediChain is and run it |
| [`architecture.md`](architecture.md) | You want the system design, with C4 and sequence diagrams |
| [`adr/`](adr/) | You want to know **why** it is built this way, and what was rejected |
| [`../SECURITY.md`](../SECURITY.md) | You want the security posture, or need to report a vulnerability |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | You are going to change the code |

## Building and running

| Document | Purpose |
|---|---|
| [`SETUP_AND_RUNNING.md`](SETUP_AND_RUNNING.md) | Full environment setup |
| [`DEV_AUTH.md`](DEV_AUTH.md) | Authentication in development |
| [`../POSTGRES_SETUP.md`](../POSTGRES_SETUP.md) | PostgreSQL configuration |
| [`mobile-setup.md`](mobile-setup.md) | Mobile client setup |
| [`jitsi-deployment.md`](jitsi-deployment.md) | Self-hosted telehealth |

## API and data

| Document | Purpose |
|---|---|
| [`api.md`](api.md) | Endpoint reference |
| [`openapi.yaml`](openapi.yaml) | Machine-readable specification |
| [`database-schema.md`](database-schema.md) | Schema reference |
| [`postgres-implementation-guide.md`](postgres-implementation-guide.md) | Hybrid chain + database patterns |

## Security, privacy and compliance

| Document | Purpose |
|---|---|
| [`SECURITY_ASSESSMENT.md`](SECURITY_ASSESSMENT.md) | How the system was assessed, and what changed |
| [`PRODUCTION_READINESS_GATES.md`](PRODUCTION_READINESS_GATES.md) | **The seven gates blocking real patient data** |
| [`GOVERNANCE_RECORD.md`](GOVERNANCE_RECORD.md) | Information Officer, prior authorisation, transborder assessment |
| [`POPIA_LEGAL_REVIEW_BRIEFING.md`](POPIA_LEGAL_REVIEW_BRIEFING.md) | The briefing that produced the legal review |
| [`security.md`](security.md) / [`security-checklist.md`](security-checklist.md) | Controls and checklist |
| [`e2ee-policy.md`](e2ee-policy.md) | Encryption policy |
| [`SECRETS_MANAGEMENT.md`](SECRETS_MANAGEMENT.md) | Secret handling |
| [`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md) | Incident playbook |

## Operations

| Document | Purpose |
|---|---|
| [`BLOCKCHAIN_OPERATIONS.md`](BLOCKCHAIN_OPERATIONS.md) | Node and chain operations |
| [`BACKUP_RESTORE_RUNBOOK.md`](BACKUP_RESTORE_RUNBOOK.md) | Backup and verified restore |
| [`monitoring.md`](monitoring.md) | Prometheus and Grafana |
| [`PERFORMANCE_BUDGETS.md`](PERFORMANCE_BUDGETS.md) | Latency budgets |
| [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md) | Deployment checklist |

## Federation

| Document | Purpose |
|---|---|
| [`FEDERATION_TEST_READINESS.md`](FEDERATION_TEST_READINESS.md) | Scenarios still to validate against a live multi-node deployment |
| [`MEDICHAIN_FEDERATION_GAP_ANALYSIS.md`](MEDICHAIN_FEDERATION_GAP_ANALYSIS.md) | Gap analysis |

## Project state

| Document | Purpose |
|---|---|
| [`TECHNICAL_DEBT_REGISTER.md`](TECHNICAL_DEBT_REGISTER.md) | Known debt, deliberately deferred until the system is complete |
| [`../IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md) | Tracked work items |
| [`FEATURE_COMPLETENESS_AUDIT.md`](FEATURE_COMPLETENESS_AUDIT.md) | Feature audit |

## Research and background

| Document | Purpose |
|---|---|
| [`medichain_master_plan.md`](medichain_master_plan.md) | Original plan and market analysis |
| [`medichain-comprehensive-research.md`](medichain-comprehensive-research.md) | Hospital workflow research |
| [`HYBRID_ARCHITECTURE_RESEARCH.md`](HYBRID_ARCHITECTURE_RESEARCH.md) | Chain-vs-database decision matrix |
| [`medical-id-research.md`](medical-id-research.md) | National ID systems |
| [`medichain-security-deep-dive.md`](medichain-security-deep-dive.md) | Security research |

---

**A note on accuracy.** Several documents in this tree predate the current
codebase and contain stale claims. Where a document's date is older than a
statement it makes about implementation status, trust the code. The counts in
[`architecture.md`](architecture.md) are reproducible from the commands in that
file.
