---
name: documentation
description: >
  Documentation discipline for MediChain — README, rustdoc/docstrings, ADRs (Architecture
  Decision Records), CHANGELOG, threat model docs, and CLAUDE.md for AI assistants. Covers
  what to document, where, and the "WHY not WHAT" rule for code comments. Activate when the
  user says "write docs", "document this", "update the README", "add docstrings", "explain
  the architecture", "ADR", "changelog", "what does this code do", or proactively after any
  major feature ships — documentation written while the code is fresh is documentation that
  gets written.
---

# Documentation for MediChain

MediChain is open source, will outlive your memory of why each decision was made, and
will be reviewed by external auditors and possibly regulators. Documentation is not
optional polish — it's a load-bearing part of the system.

---

## The Documentation Hierarchy

```
1. CLAUDE.md       → architecture for AI assistants (you, future-you, Claude Code)
2. README          → how to set up, run, contribute (for humans)
3. ADRs            → WHY we chose X over Y (for future-you and reviewers)
4. THREAT-MODEL.md → security assumptions and adversaries
5. PRIVACY.md      → POPIA/HIPAA stance and data handling
6. CHANGELOG       → what changed between versions (for users + auditors)
7. Rustdoc/JSDoc   → what each function/struct does (for callers)
8. Inline comments → WHY this code (the code itself shows WHAT)
9. SECURITY.md     → how to report vulnerabilities responsibly
```

---

## CLAUDE.md (root of repo)

This file is the first thing an AI assistant reads. Make it count.

---

## README.md (project root)

Aimed at: a developer who landed here from GitHub and has 5 minutes.

Structure:
1. **One-line description** (the elevator pitch)
2. **Why** (why does this exist?)
3. **Status** (alpha / beta / production)
4. **Quick start** (clone, install, run)
5. **Architecture diagram** (one image, high-level)
6. **Documentation links** (to all the other docs)
7. **Contributing** (how to PR, code style, tests required)
8. **License** (MIT? Apache 2? Something else?)

Don't bury the lede. The first paragraph should answer "what is this and should I care?".

---

## ADRs — Architecture Decision Records

Every significant architectural choice gets an ADR. Format:

ADRs live in `docs/adr/0001-xxx.md`, numbered sequentially, never edited after
acceptance — write a new one that supersedes if the decision changes.

---

## Rustdoc — Function and Type Documentation

Run `cargo doc --open` to see your docs rendered. If they look bad, they ARE bad.

---

## Inline Comments — WHY, not WHAT

If a comment just restates the code, delete it. If a comment requires the code to be
understood, the code probably needs simplifying.

---

## CHANGELOG (Keep a Changelog format)

The auditor will read this. The user reading the release notes will read this.
Take it seriously.

---

## SECURITY.md

---

## Documentation Checklist (per PR)

For every PR, ask:

- [ ] If this changes architecture, is there an ADR?
- [ ] If this adds a public function/type, does it have rustdoc/JSDoc?
- [ ] If this changes user-visible behaviour, is the CHANGELOG updated?
- [ ] If this changes how to set up the project, is the README updated?
- [ ] If this affects security posture, is THREAT-MODEL.md or SECURITY.md updated?
- [ ] If this affects PHI handling, is PRIVACY.md updated?
- [ ] If this affects how Claude/AI should reason about the code, is CLAUDE.md updated?

Documentation is part of "done." Code without docs is half-built.
