# Architecture Decision Records

An ADR captures a decision that was expensive to make and would be expensive to
reverse: the context at the time, the options considered, what was chosen, and
what it cost. Format follows Michael Nygard's
[original convention](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

**Why these exist.** Code shows what the system does. It does not show what was
rejected, or why an apparently-odd choice is deliberate. Without that record the
next engineer — including a future version of the author — "fixes" something
load-bearing. Two entries here (0004, 0005) exist precisely because a legal
review overturned an earlier decision, and the reasoning has to survive.

ADRs are **immutable once accepted**. A decision that changes gets a new ADR that
supersedes the old one; the old one stays, marked superseded. The history is the
point.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-dual-storage-backends.md) | Two storage backends behind one repository trait | Accepted |
| [0002](0002-server-sent-events-over-websockets.md) | Server-Sent Events instead of WebSockets | Accepted |
| [0003](0003-wallet-auth-with-jwt.md) | Wallet signature auth with JWT sessions | Accepted |
| [0004](0004-commitment-not-plaintext-on-chain.md) | On-chain commitments, never plaintext health data | Accepted — supersedes 0004-draft |
| [0005](0005-retention-restriction-before-deletion.md) | Restriction before deletion for retention | Accepted |
| [0006](0006-federated-deployment.md) | Federated per-hospital deployment | Accepted |

## Template

```markdown
# ADR-NNNN: Title

- **Status:** Proposed | Accepted | Superseded by ADR-NNNN | Deprecated
- **Date:** YYYY-MM-DD
- **Deciders:** who

## Context
The forces at play. What made this a decision rather than an obvious step.

## Options considered
Each with its actual trade-off, including the one chosen.

## Decision
What was chosen, stated plainly.

## Consequences
What this makes easy, what it makes hard, and what it costs. Include the
negative consequences — an ADR with only upsides is marketing, not a record.
```
